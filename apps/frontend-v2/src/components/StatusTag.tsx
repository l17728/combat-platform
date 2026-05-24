import { Tag } from 'antd';
import {
  ClockCircleOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons';
import { STATUS_COLOR, LEVEL_COLOR, CONTRIBUTION_COLOR } from '../constants.js';

interface StatusTagProps {
  status: string;
  type?: 'status' | 'level' | 'contribution';
}

const COLOR_MAPS = {
  status: STATUS_COLOR,
  level: LEVEL_COLOR,
  contribution: CONTRIBUTION_COLOR,
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  '待响应': <ClockCircleOutlined />,
  '处理中': <SyncOutlined spin />,
  '进行中': <ThunderboltOutlined />,
  '已解决': <CheckCircleOutlined />,
  '已关闭': <MinusCircleOutlined />,
};

export default function StatusTag({ status, type = 'status' }: StatusTagProps) {
  const colorMap = COLOR_MAPS[type];
  const color = colorMap[status] || 'default';
  const icon = type === 'status' ? STATUS_ICONS[status] : undefined;
  return (
    <Tag color={color} icon={icon} style={{ marginInlineEnd: 0 }}>
      {status}
    </Tag>
  );
}
