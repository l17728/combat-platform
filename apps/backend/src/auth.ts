import { Router, type Request, type Response, type NextFunction } from "express";
import type { DbAdapter } from "./db-adapter.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { log, asyncHandler } from "./logger.js";

const DEFAULT_JWT_SECRET = "combat-platform-secret-2026";

/**
 * 启动期强制校验 JWT_SECRET:
 *   - production 环境必须显式设置 process.env.JWT_SECRET,否则进程退出(防止默认弱密钥被
 *     公开签发 admin token,P0-2)。
 *   - 非 production 环境若使用默认串,打印 warn 提示但允许启动以方便开发/测试。
 * 注意:本函数在模块顶层加载时同步执行,部署 systemd Unit 必须通过 EnvironmentFile 注入。
 */
function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    if (!fromEnv) {
      // eslint-disable-next-line no-console
      console.error("[FATAL] JWT_SECRET 未设置,生产环境必须通过环境变量注入随机 32+ 字节密钥");
      process.exit(1);
    }
    if (fromEnv === DEFAULT_JWT_SECRET) {
      // eslint-disable-next-line no-console
      console.error("[FATAL] JWT_SECRET 不能使用代码默认值,请在 systemd EnvironmentFile 中设置随机密钥");
      process.exit(1);
    }
    return fromEnv;
  }
  if (!fromEnv) {
    // eslint-disable-next-line no-console
    console.warn("[WARN] JWT_SECRET 未设置,正在使用默认开发密钥;部署前必须在生产环境通过环境变量注入");
    return DEFAULT_JWT_SECRET;
  }
  if (fromEnv === DEFAULT_JWT_SECRET) {
    // eslint-disable-next-line no-console
    console.warn("[WARN] JWT_SECRET 等于代码默认值,部署前必须替换为随机密钥");
  }
  return fromEnv;
}

const JWT_SECRET = resolveJwtSecret();
const JWT_EXPIRES_IN = "7d";

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface JwtPayload {
  userId: string;
  username: string;
  role: string;
}

/**
 * Mint a short-lived service token for the local Hermes agent (opencode) so its
 * read-only tools can call the authenticated API on localhost. Read-only is
 * enforced at the tool layer (only GET wrappers) + agent permissions, not by
 * the token role; the token only satisfies authMiddleware.
 */
export function signServiceToken(): string {
  const payload: JwtPayload = { userId: "hermes-agent", username: "hermes-agent", role: "admin" };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "365d" });
}

function toUser(r: any): AuthUser {
  return {
    id: r.id,
    username: r.username,
    role: r.role,
    displayName: r.display_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function ensureDefaultAdmin(adapter: DbAdapter): Promise<void> {
  // Cross-dialect: uses adapter (SQLite + Postgres). Fire-and-forget at boot.
  const row = await adapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM users");
  const count = Number(row?.c ?? 0);
  if (count === 0) {
    const hash = bcrypt.hashSync("admin123", 10);
    const now = new Date().toISOString();
    await adapter.run(
      "INSERT INTO users (id, username, password_hash, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [randomUUID(), "admin", hash, "admin", "系统管理员", now, now]
    );
    log.info("auth.default_admin_created");
  }
}

export function makeAuthRouter(adapter: DbAdapter): Router {
  // Fire-and-forget — async seed, failures logged but don't block.
  ensureDefaultAdmin(adapter).catch((err) =>
    log.warn("auth.ensure_default_admin_failed", { error: (err as Error).message })
  );
  const r = Router();

  r.post(
    "/auth/login",
    asyncHandler(async (req, res) => {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        return res.status(400).json({ error: "请输入用户名和密码" });
      }
      const row = await adapter.queryOne<any>("SELECT * FROM users WHERE username = ?", [username]);
      if (!row) {
        return res.status(401).json({ error: "用户名或密码错误" });
      }
      if (!bcrypt.compareSync(password, row.password_hash)) {
        return res.status(401).json({ error: "用户名或密码错误" });
      }
      const payload: JwtPayload = { userId: row.id, username: row.username, role: row.role };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      log.info("auth.login", { username, role: row.role });
      // P1 强制改密:默认管理员 admin/admin123 必须改完密才能继续业务流。
      // 前端收到 passwordMustChange=true 后弹强制 modal,不允许跳过。
      const passwordMustChange = username === "admin" && password === "admin123";
      res.json({ token, user: toUser(row), passwordMustChange });
    })
  );

  r.post(
    "/auth/register",
    asyncHandler(async (req, res) => {
      const { username, password, displayName } = req.body as {
        username?: string;
        password?: string;
        displayName?: string;
      };
      if (!username || !password) {
        return res.status(400).json({ error: "请输入用户名和密码" });
      }
      if (username.length < 2 || username.length > 32) {
        return res.status(400).json({ error: "用户名长度 2-32 个字符" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "密码至少 6 个字符" });
      }
      const existing = await adapter.queryOne<{ id: string }>("SELECT id FROM users WHERE username = ?", [username]);
      if (existing) {
        return res.status(409).json({ error: "用户名已存在" });
      }
      const hash = bcrypt.hashSync(password, 10);
      const now = new Date().toISOString();
      const id = randomUUID();
      // P0-1 安全:公开自注册强制 role=normal,忽略客户端传入的 role 字段。
      // 提升权限(leader/admin)必须由已登录的 admin 通过 POST /api/users 创建。
      const userRole = "normal";
      await adapter.run(
        "INSERT INTO users (id, username, password_hash, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, username, hash, userRole, displayName ?? username, now, now]
      );
      log.info("auth.register", { username, role: userRole });
      const payload: JwtPayload = { userId: id, username, role: userRole };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
      const user = await adapter.queryOne<any>("SELECT * FROM users WHERE id = ?", [id]);
      res.status(201).json({ token, user: toUser(user) });
    })
  );

  r.get(
    "/auth/me",
    asyncHandler(async (req, res) => {
      const payload = verifyAuth(req);
      if (!payload) {
        if (process.env.COMBAT_NO_AUTH === "1") {
          const admin = await adapter.queryOne<any>("SELECT * FROM users WHERE username = ?", ["admin"]);
          if (admin) return res.json({ user: toUser(admin) });
        }
        return res.status(401).json({ error: "未登录或 token 已过期" });
      }
      const row = await adapter.queryOne<any>("SELECT * FROM users WHERE id = ?", [payload.userId]);
      if (!row) {
        return res.status(401).json({ error: "用户不存在" });
      }
      // P1 强制改密:admin 若仍是默认密 admin123 → 持续返回 mustChange,直到改成功。
      const mustChange = row.username === "admin" && bcrypt.compareSync("admin123", row.password_hash);
      res.json({ user: toUser(row), passwordMustChange: mustChange });
    })
  );

  r.put(
    "/auth/change-password",
    asyncHandler(async (req, res) => {
      const payload = verifyAuth(req);
      if (!payload) {
        return res.status(401).json({ error: "未登录" });
      }
      const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
      if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: "请输入旧密码和新密码" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ error: "新密码至少 6 个字符" });
      }
      const row = await adapter.queryOne<any>("SELECT * FROM users WHERE id = ?", [payload.userId]);
      if (!row || !bcrypt.compareSync(oldPassword, row.password_hash)) {
        return res.status(401).json({ error: "旧密码错误" });
      }
      const hash = bcrypt.hashSync(newPassword, 10);
      await adapter.run("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", [
        hash,
        new Date().toISOString(),
        payload.userId,
      ]);
      log.info("auth.password_changed", { username: payload.username });
      res.json({ ok: true });
    })
  );

  return r;
}

export function makeUserAdminRouter(adapter: DbAdapter): Router {
  const r = Router();

  r.get(
    "/users",
    asyncHandler(async (req, res) => {
      const payload = requireAdmin(req);
      if (!payload) return res.status(403).json({ error: "仅管理员可管理用户" });
      const rows = await adapter.query<any>(
        "SELECT id, username, role, display_name, created_at, updated_at FROM users ORDER BY created_at"
      );
      res.json(rows.map(toUser));
    })
  );

  r.post(
    "/users",
    asyncHandler(async (req, res) => {
      const payload = requireAdmin(req);
      if (!payload) return res.status(403).json({ error: "仅管理员可创建用户" });
      const { username, password, displayName, role } = req.body as {
        username?: string;
        password?: string;
        displayName?: string;
        role?: string;
      };
      if (!username || !password) {
        return res.status(400).json({ error: "用户名和密码不能为空" });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: "密码至少 6 个字符" });
      }
      const existing = await adapter.queryOne<{ id: string }>("SELECT id FROM users WHERE username = ?", [username]);
      if (existing) {
        return res.status(409).json({ error: "用户名已存在" });
      }
      const hash = bcrypt.hashSync(password, 10);
      const now = new Date().toISOString();
      const id = randomUUID();
      const userRole = ["admin", "leader", "normal"].includes(role ?? "") ? role! : "normal";
      await adapter.run(
        "INSERT INTO users (id, username, password_hash, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, username, hash, userRole, displayName ?? username, now, now]
      );
      log.info("auth.user_created", { by: payload.username, created: username, role: userRole });
      const row = await adapter.queryOne<any>(
        "SELECT id, username, role, display_name, created_at, updated_at FROM users WHERE id = ?",
        [id]
      );
      res.status(201).json(toUser(row));
    })
  );

  r.patch(
    "/users/:id",
    asyncHandler(async (req, res) => {
      const payload = requireAdmin(req);
      if (!payload) return res.status(403).json({ error: "仅管理员可编辑用户" });
      const { id } = req.params;
      const { role, displayName, password } = req.body as { role?: string; displayName?: string; password?: string };
      const existing = await adapter.queryOne<any>("SELECT * FROM users WHERE id = ?", [id]);
      if (!existing) {
        return res.status(404).json({ error: "用户不存在" });
      }
      const updates: string[] = [];
      const params: any[] = [];
      if (role && ["admin", "leader", "normal"].includes(role)) {
        updates.push("role = ?");
        params.push(role);
      }
      if (displayName !== undefined) {
        updates.push("display_name = ?");
        params.push(displayName);
      }
      if (password) {
        if (password.length < 6) {
          return res.status(400).json({ error: "密码至少 6 个字符" });
        }
        updates.push("password_hash = ?");
        params.push(bcrypt.hashSync(password, 10));
      }
      if (updates.length === 0) {
        return res.status(400).json({ error: "没有要更新的字段" });
      }
      updates.push("updated_at = ?");
      params.push(new Date().toISOString());
      params.push(id);
      await adapter.run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, params);
      log.info("auth.user_updated", { by: payload.username, target: id, fields: Object.keys(req.body) });
      const row = await adapter.queryOne<any>(
        "SELECT id, username, role, display_name, created_at, updated_at FROM users WHERE id = ?",
        [id]
      );
      res.json(toUser(row));
    })
  );

  r.delete(
    "/users/:id",
    asyncHandler(async (req, res) => {
      const payload = requireAdmin(req);
      if (!payload) return res.status(403).json({ error: "仅管理员可删除用户" });
      const { id } = req.params;
      if (payload.userId === id) {
        return res.status(400).json({ error: "不能删除自己" });
      }
      const existing = await adapter.queryOne<any>("SELECT * FROM users WHERE id = ?", [id]);
      if (!existing) {
        return res.status(404).json({ error: "用户不存在" });
      }
      await adapter.run("DELETE FROM users WHERE id = ?", [id]);
      log.info("auth.user_deleted", { by: payload.username, deleted: existing.username });
      res.json({ ok: true });
    })
  );

  return r;
}

export function verifyAuth(req: { headers: Record<string, unknown> }): JwtPayload | null {
  const auth = req.headers["authorization"] as string | undefined;
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(auth.slice(7), JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

function requireAdmin(req: { headers: Record<string, unknown> }): JwtPayload | null {
  if (process.env.COMBAT_NO_AUTH === "1") {
    return { userId: "no-auth-admin", username: "admin", role: "admin" };
  }
  const payload = verifyAuth(req);
  if (!payload) return null;
  if (payload.role !== "admin") return null;
  return payload;
}

/**
 * P0-4 修复:管理员守卫中间件。挂在敏感路由(merge/backup/email/op-log/audit/
 * proposals/reminders 等)前,确保只有 admin JWT 才能调用。
 * - COMBAT_NO_AUTH=1 → 直放(e2e 测试 bypass)
 * - 缺失/无效 token → 401
 * - role !== 'admin' → 403
 */
export function adminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.COMBAT_NO_AUTH === "1") return next();
  const payload = verifyAuth(req);
  if (!payload) {
    res.status(401).json({ error: "未登录或 token 已过期" });
    return;
  }
  if (payload.role !== "admin") {
    log.warn("auth.admin_denied", { username: payload.username, role: payload.role, path: req.path });
    res.status(403).json({ error: "仅管理员可访问" });
    return;
  }
  (req as any).user = payload;
  next();
}

/**
 * P0-4 修复:Leader+ 守卫中间件(admin 或 leader 角色)。挂在不应让 normal 调用
 * 但 leader 又确有合法需求的路由上(如 ticket-tabs/documents 编辑)。
 */
export function leaderMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.COMBAT_NO_AUTH === "1") return next();
  const payload = verifyAuth(req);
  if (!payload) {
    res.status(401).json({ error: "未登录或 token 已过期" });
    return;
  }
  if (payload.role !== "admin" && payload.role !== "leader") {
    log.warn("auth.leader_denied", { username: payload.username, role: payload.role, path: req.path });
    res.status(403).json({ error: "仅 Leader 或管理员可访问" });
    return;
  }
  (req as any).user = payload;
  next();
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (process.env.COMBAT_NO_AUTH === "1") return next();
  const path = req.path;
  const publicPaths = ["/auth/login", "/auth/register", "/help/feedback/", "/bug-reports", "/health", "/metrics"];
  if (publicPaths.some((p) => path.startsWith(p)) && (path === "/bug-reports" ? req.method === "POST" : true)) {
    return next();
  }
  // Public document download: links embedded in MD content are clicked in a new
  // tab without a Bearer token, so allow GET /documents/:id/download only.
  if (req.method === "GET" && /^\/documents\/[^/]+\/download$/.test(path)) {
    return next();
  }
  const payload = verifyAuth(req);
  if (!payload) {
    res.status(401).json({ error: "未登录或 token 已过期" });
    return;
  }
  (req as any).user = payload;
  next();
}
