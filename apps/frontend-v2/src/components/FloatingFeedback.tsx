import { useState } from "react";
import { FloatButton, Drawer, Form, Input, Select, Button, message, Image } from "antd";
import { CameraOutlined } from "@ant-design/icons";
import { api } from "../api.js";
import { useAuth } from "../hooks/useAuth.js";
import { useSettings } from "../hooks/useSettings.js";
import { getCapturedLogs } from "../utils/console-capture.js";
import { handleApiError } from "../utils/handleApiError.js";

const { TextArea } = Input;

export default function FloatingFeedback() {
  const { user } = useAuth();
  const { getValues } = useSettings();
  const SEVERITY_OPTIONS = getValues("Bug 严重程度", ["严重", "较高", "一般", "建议"]).map((v) => ({
    value: v,
    label: v,
  }));
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [capturedUrl, setCapturedUrl] = useState("");
  const [form] = Form.useForm();

  const captureAndOpen = async () => {
    const url = window.location.href;
    const hide = message.loading("正在截取当前页面…", 0);
    let shot: string | null = null;
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(document.body, {
        logging: false,
        useCORS: true,
        backgroundColor: "#ffffff",
        scale: 1,
        width: window.innerWidth,
        height: window.innerHeight,
        x: window.scrollX,
        y: window.scrollY,
        ignoreElements: (el) => !!el.classList?.contains?.("feedback-float-ignore"),
      });
      // JPEG 0.7 体积通常仅 PNG 的 1/3 ~ 1/5,避免后端 body 超限(20mb)被拒。
      shot = canvas.toDataURL("image/jpeg", 0.7);
    } catch {
      // Capture can fail (e.g. tainted canvas from cross-origin images);
      // still open the form so the user can submit text-only feedback.
    } finally {
      hide();
    }
    setScreenshot(shot);
    setCapturedUrl(url);
    setOpen(true);
  };

  const handleSubmit = async (values: { title: string; severity?: string; description?: string; pageUrl?: string }) => {
    setSubmitting(true);
    try {
      await api.createBugReport({
        title: values.title,
        description: values.description,
        severity: values.severity || "一般",
        pageUrl: values.pageUrl || capturedUrl || window.location.href,
        reporter: user?.displayName || user?.username || "",
        screenshot: screenshot ?? undefined,
        consoleLogs: getCapturedLogs() || undefined,
        userAgent: navigator.userAgent,
      });
      message.success("反馈已提交");
      // 通知问题反馈列表页(如果同时打开)立即拉取最新条目;CustomEvent 比 storage event 更精准。
      window.dispatchEvent(new CustomEvent("bug-report:created"));
      setOpen(false);
      setScreenshot(null);
      form.resetFields();
    } catch (e) {
      handleApiError(e, "提交反馈失败");
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    setOpen(false);
    setScreenshot(null);
    form.resetFields();
  };

  return (
    <>
      <FloatButton
        className="feedback-float-ignore"
        type="primary"
        icon={<CameraOutlined />}
        tooltip="截图反馈"
        onClick={captureAndOpen}
        style={{ right: 24, bottom: 24 }}
      />
      <Drawer
        title="截图反馈"
        width={480}
        open={open}
        onClose={close}
        destroyOnClose
        maskClosable={false}
        extra={
          <Button type="primary" loading={submitting} onClick={() => form.submit()}>
            提交反馈
          </Button>
        }
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ severity: "一般", pageUrl: capturedUrl }}
        >
          <Form.Item name="title" label="问题标题" rules={[{ required: true, message: "请输入问题标题" }]}>
            <Input placeholder="一句话描述问题" />
          </Form.Item>
          <Form.Item name="pageUrl" label="问题页面链接">
            <Input placeholder="问题发生的页面地址（已自动记录）" />
          </Form.Item>
          <Form.Item name="severity" label="严重程度">
            <Select options={SEVERITY_OPTIONS} />
          </Form.Item>
          <Form.Item name="description" label="问题描述">
            <TextArea rows={4} placeholder="详细描述问题现象、复现步骤、预期行为等" />
          </Form.Item>
          <Form.Item label="截图（已自动截取当前页面）">
            {screenshot ? (
              <Image
                src={screenshot}
                alt="screenshot"
                style={{ maxHeight: 220, border: "1px solid #d9d9d9", borderRadius: 4 }}
              />
            ) : (
              <span style={{ color: "#999" }}>未能自动截取页面，可直接提交文字反馈</span>
            )}
          </Form.Item>
        </Form>
      </Drawer>
    </>
  );
}
