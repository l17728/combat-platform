import { useState } from 'react';
import { Modal, Form, Input, Select, message, Radio } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { api, type TicketTab } from '../api.js';
import { TAB_TYPE_LABEL } from '../constants.js';

interface Props {
  ticketId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (tab: TicketTab) => void;
}

export default function AddTabModal({ ticketId, open, onClose, onCreated }: Props) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [tabType, setTabType] = useState<'link' | 'custom'>('link');

  const handleSubmit = async (values: { tabType: 'link' | 'custom'; title: string }) => {
    setSubmitting(true);
    try {
      const tab = await api.createTicketTab(ticketId, {
        tabType: values.tabType,
        title: values.title,
        config: values.tabType === 'link' ? {} : undefined,
        content: values.tabType === 'custom' ? '' : undefined,
      });
      message.success('标签已创建');
      form.resetFields();
      setTabType('link');
      onCreated(tab);
    } catch (e: any) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="添加标签"
      open={open}
      onCancel={() => { form.resetFields(); setTabType('link'); onClose(); }}
      onOk={() => form.submit()}
      okText="创建"
      confirmLoading={submitting}
      destroyOnClose
    >
      <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ tabType: 'link' }}>
        <Form.Item name="tabType" label="标签类型" rules={[{ required: true }]}>
          <Radio.Group onChange={e => setTabType(e.target.value)}>
            <Radio.Button value="link">{TAB_TYPE_LABEL['link']}</Radio.Button>
            <Radio.Button value="custom">{TAB_TYPE_LABEL['custom']}</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="title" label="标签名称" rules={[{ required: true, message: '请输入标签名称' }]}>
          <Input placeholder={tabType === 'link' ? '如：相关贡献、负责人...' : '如：会议笔记、技术方案...'} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
