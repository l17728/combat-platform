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

  const DEFAULT_CUSTOM_TITLE = '信息广场';

  const handleSubmit = async (values: { tabType: 'link' | 'custom'; title: string }) => {
    setSubmitting(true);
    try {
      const title = values.tabType === 'custom' && !values.title?.trim()
        ? DEFAULT_CUSTOM_TITLE
        : values.title;
      const tab = await api.createTicketTab(ticketId, {
        tabType: values.tabType,
        title,
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

  const handleTypeChange = (type: 'link' | 'custom') => {
    setTabType(type);
    if (type === 'custom') {
      form.setFieldValue('title', '');
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
          <Radio.Group onChange={e => handleTypeChange(e.target.value)}>
            <Radio.Button value="link">{TAB_TYPE_LABEL['link']}</Radio.Button>
            <Radio.Button value="custom">{TAB_TYPE_LABEL['custom']}</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="title" label="标签名称" rules={tabType === 'link' ? [{ required: true, message: '请输入标签名称' }] : []}>
          <Input placeholder={tabType === 'link' ? '如：相关贡献、负责人...' : '留空则默认为「信息广场」'} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
