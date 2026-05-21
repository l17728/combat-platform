import { useEffect, useState, useCallback } from "react";
import { Card, Form, Input, InputNumber, Switch, Button, Select, Space, Typography, message } from "antd";
import { api } from "../api.js";
import type { SmtpConfigMasked, EmailSendResult, GraphNode } from "@combat/shared";

export function EmailPage() {
  const [form] = Form.useForm();
  const [masked, setMasked] = useState<SmtpConfigMasked | null>(null);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<EmailSendResult | null>(null);

  // compose
  const [persons, setPersons] = useState<GraphNode[]>([]);
  const [groups, setGroups] = useState<GraphNode[]>([]);
  const [to, setTo] = useState<string[]>([]);
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [personNames, setPersonNames] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<EmailSendResult | null>(null);

  const loadConfig = useCallback(() => {
    api.getEmailConfig().then(cfg => {
      setMasked(cfg);
      form.setFieldsValue({
        host: cfg.host, port: cfg.port, secure: cfg.secure,
        username: cfg.username, password: "",
        fromEmail: cfg.fromEmail, fromName: cfg.fromName,
      });
    }).catch(() => message.error("配置加载失败"));
  }, [form]);

  useEffect(() => { loadConfig(); }, [loadConfig]);
  useEffect(() => {
    api.listNodes("person").then(setPersons).catch(() => {});
    api.listNodes("emailGroup").then(setGroups).catch(() => {});
  }, []);

  const saveConfig = async () => {
    const vals = await form.validateFields();
    const cfg: Record<string, unknown> = { ...vals };
    // 空密码不覆盖：从提交对象删掉空字符串 password
    if (cfg.password === "" || cfg.password == null) delete cfg.password;
    setSaving(true);
    try {
      await api.putEmailConfig(cfg);
      message.success("配置已保存");
      loadConfig();
    } catch (e) { message.error(String((e as Error).message)); }
    finally { setSaving(false); }
  };

  const doTest = async () => {
    const t = testTo.trim();
    if (!t) { message.warning("请输入测试收件人"); return; }
    setTesting(true);
    try {
      const r = await api.testEmail(t);
      setTestResult(r);
      if (r.ok) message.success("测试邮件已发送"); else message.error(r.error || "测试失败");
    } catch (e) { message.error(String((e as Error).message)); }
    finally { setTesting(false); }
  };

  const doSend = async () => {
    if (!subject.trim()) { message.warning("请输入主题"); return; }
    setSending(true);
    try {
      const r = await api.sendEmail({ to, groupNames, personNames, subject, body });
      setSendResult(r);
      if (r.ok) message.success("邮件已发送"); else message.error(r.error || "发送失败");
    } catch (e) { message.error(String((e as Error).message)); }
    finally { setSending(false); }
  };

  const personOptions = persons
    .filter(p => p.properties?.["email"])
    .map(p => ({ label: String(p.properties?.["name"] ?? p.id), value: String(p.properties?.["name"] ?? p.id) }));
  const groupOptions = groups
    .map(g => String(g.properties?.["组名"] ?? ""))
    .filter(Boolean)
    .map(n => ({ label: n, value: n }));

  return (
    <div style={{ padding: 24, display: "grid", gap: 16, maxWidth: 720 }}>
      <Typography.Title level={3} style={{ marginTop: 0 }}>邮件通知</Typography.Title>

      <Card aria-label="smtp-config" title="SMTP 配置">
        <Form form={form} layout="vertical">
          <Form.Item label="SMTP 主机" name="host" rules={[{ required: true, message: "请输入主机" }]}>
            <Input aria-label="smtp-host" placeholder="smtp.example.com" />
          </Form.Item>
          <Form.Item label="端口" name="port">
            <InputNumber aria-label="smtp-port" style={{ width: "100%" }} placeholder="465" />
          </Form.Item>
          <Form.Item label="SSL (secure)" name="secure" valuePropName="checked">
            <Switch aria-label="smtp-secure" />
          </Form.Item>
          <Form.Item label="用户名" name="username">
            <Input aria-label="smtp-username" />
          </Form.Item>
          <Form.Item label="密码" name="password"
            extra={masked?.passwordSet ? "已设置，留空保持不变" : "尚未设置密码"}>
            <Input.Password aria-label="smtp-password"
              placeholder={masked?.passwordSet ? "已设置则留空保持不变" : "请输入密码"} />
          </Form.Item>
          <Form.Item label="发件人邮箱" name="fromEmail" rules={[{ required: true, message: "请输入发件人邮箱" }]}>
            <Input aria-label="smtp-fromEmail" placeholder="ops@example.com" />
          </Form.Item>
          <Form.Item label="发件人名称" name="fromName">
            <Input aria-label="smtp-fromName" />
          </Form.Item>
          <Button type="primary" loading={saving} onClick={saveConfig}>保存配置</Button>
        </Form>

        <div style={{ marginTop: 16 }}>
          <Typography.Text strong>发送测试</Typography.Text>
          <Space.Compact style={{ display: "flex", marginTop: 8 }}>
            <Input aria-label="test-to" placeholder="测试收件人邮箱" value={testTo}
              onChange={e => setTestTo(e.target.value)} />
            <Button loading={testing} onClick={doTest}>发送测试</Button>
          </Space.Compact>
          {testResult && (
            <div aria-label="test-result" style={{ marginTop: 8 }}>
              {testResult.ok ? "成功" : "失败"} · 收件人：{testResult.recipients.join(", ")}
              {testResult.error ? ` · ${testResult.error}` : ""}
            </div>
          )}
        </div>
      </Card>

      <Card aria-label="email-compose" title="撰写发送">
        <Form layout="vertical">
          <Form.Item label="收件人（自由邮箱）">
            <Select aria-label="email-to" mode="tags" value={to} onChange={setTo}
              placeholder="输入邮箱后回车" tokenSeparators={[",", " "]} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="邮件群组">
            <Select aria-label="email-groups" mode="multiple" value={groupNames} onChange={setGroupNames}
              options={groupOptions} placeholder="选择邮件群组" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="人员">
            <Select aria-label="email-persons" mode="multiple" value={personNames} onChange={setPersonNames}
              options={personOptions} placeholder="选择人员（仅含有邮箱者）" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="主题">
            <Input aria-label="email-subject" value={subject} onChange={e => setSubject(e.target.value)} />
          </Form.Item>
          <Form.Item label="正文">
            <Input.TextArea aria-label="email-body" rows={6} value={body} onChange={e => setBody(e.target.value)} />
          </Form.Item>
          <Button type="primary" loading={sending} onClick={doSend}>发送</Button>
        </Form>
        {sendResult && (
          <Card aria-label="email-result" size="small" style={{ marginTop: 12 }}
            title={sendResult.ok ? "发送成功" : "发送失败"}>
            <div>收件人（{sendResult.recipients.length}）：{sendResult.recipients.join(", ")}</div>
            <div>状态：{sendResult.ok ? "ok" : "failed"}</div>
            {sendResult.error && <div>错误：{sendResult.error}</div>}
          </Card>
        )}
      </Card>
    </div>
  );
}
