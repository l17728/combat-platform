import { useEffect, useState } from 'react';
import { Modal, Form, Input, Select, message, Radio } from 'antd';
import { api, type TicketTab } from '../api.js';
import { TAB_TYPE_LABEL } from '../constants.js';
import type { GraphNode } from '@combat/shared';

interface Props {
  ticketId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (tab: TicketTab) => void;
}

const DEFAULT_CUSTOM_TITLE = '信息广场';
const POSTER_TITLE = '全局广场海报';

export default function AddTabModal({ ticketId, open, onClose, onCreated }: Props) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [tabType, setTabType] = useState<'link' | 'custom'>('link');
  const [infoCards, setInfoCards] = useState<GraphNode[]>([]);

  useEffect(() => {
    if (open) api.listNodes('infoCard').then(setInfoCards).catch(() => setInfoCards([]));
  }, [open]);

  const handleSubmit = async (values: { tabType: 'link' | 'custom'; title?: string; posterCardIds?: string[] }) => {
    setSubmitting(true);
    try {
      const posterCardIds = values.tabType === 'link' ? (values.posterCardIds ?? []) : [];
      let title = values.title?.trim();
      if (!title) {
        title = values.tabType === 'custom'
          ? DEFAULT_CUSTOM_TITLE
          : (posterCardIds.length > 0 ? POSTER_TITLE : '关联数据');
      }
      const tab = await api.createTicketTab(ticketId, {
        tabType: values.tabType,
        title,
        config: values.tabType === 'link' ? { posterCardIds } : undefined,
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
        <Form.Item name="title" label="标签名称" rules={tabType === 'link' ? [{ required: true, message: '请输入标签名称' }] : []}>
          <Input placeholder={tabType === 'link' ? '如：全局广场海报、相关贡献…' : '留空则默认为「信息广场」'} />
        </Form.Item>
        {tabType === 'link' && (
          <Form.Item name="posterCardIds" label="信息广场卡片（多选即「全局广场海报」，可链接到信息广场）">
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="选择要展示的信息广场卡片"
              options={infoCards.map(c => ({ value: c.id, label: String(c.properties['标题'] ?? c.id.slice(0, 8)) }))}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
