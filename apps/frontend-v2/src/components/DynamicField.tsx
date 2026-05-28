import { Select, Input, type SelectProps, type InputProps } from 'antd';
import { useSettings } from '../hooks/useSettings.js';

interface DynamicFieldProps {
  optionsKey?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  style?: React.CSSProperties;
  size?: SelectProps['size'] | InputProps['size'];
  disabled?: boolean;
}

export default function DynamicField({
  optionsKey, value, onChange, placeholder, allowClear, style, size, disabled,
}: DynamicFieldProps) {
  const { getValues } = useSettings();
  if (!optionsKey) {
    return <Input value={value} onChange={e => onChange?.(e.target.value)} placeholder={placeholder}
      style={style} size={size as InputProps['size']} disabled={disabled} allowClear={allowClear} />;
  }
  const options = getValues(optionsKey);
  if (options.length === 0) {
    return <Input value={value} onChange={e => onChange?.(e.target.value)} placeholder={placeholder || '自由输入（配置项无选项）'}
      style={style} size={size as InputProps['size']} disabled={disabled} allowClear={allowClear} />;
  }
  return <Select value={value} onChange={v => onChange?.(v ?? '')} placeholder={placeholder}
    allowClear={allowClear} style={style} size={size as SelectProps['size']} disabled={disabled}
    options={options.map(v => ({ value: v, label: v }))} showSearch optionFilterProp="label" />;
}
