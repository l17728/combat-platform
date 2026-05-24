import { Tag } from 'antd';
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

export default function StatusTag({ status, type = 'status' }: StatusTagProps) {
  const colorMap = COLOR_MAPS[type];
  const color = colorMap[status] || 'default';
  return <Tag color={color}>{status}</Tag>;
}
