import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Result, Button } from 'antd';
import { captureException } from '../sentry.js';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error, { componentStack: info.componentStack });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="页面出了点问题"
          subTitle={this.state.error?.message || '请刷新页面重试'}
          extra={[
            <Button key="retry" type="primary" onClick={this.handleReset}>重试</Button>,
            <Button key="home" onClick={() => { window.location.hash = '/'; window.location.reload(); }}>返回首页</Button>,
          ]}
        />
      );
    }
    return this.props.children;
  }
}
