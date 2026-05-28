import { useState } from 'react';
import { Button, Modal } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function HelpButton({ title, content }: { title: string; content: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="text"
        icon={<QuestionCircleOutlined />}
        onClick={() => setOpen(true)}
        style={{ color: '#8c8c8c' }}
        data-testid="page-help-btn"
      />
      <Modal
        title={title}
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={560}
        destroyOnClose
      >
        <div className="markdown-body" style={{ maxHeight: '60vh', overflowY: 'auto', paddingRight: 8 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      </Modal>
    </>
  );
}
