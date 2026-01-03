
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertOctagon, RefreshCcw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex items-center justify-center p-8">
            <div className="bg-red-50 border border-red-100 rounded-3xl p-8 max-w-md text-center shadow-sm">
                <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-4 text-red-500 shadow-sm">
                    <AlertOctagon size={32} />
                </div>
                <h2 className="text-lg font-bold text-red-800 mb-2">页面运行遇到问题</h2>
                <p className="text-sm text-red-600 mb-6 leading-relaxed">
                    检测到组件渲染异常，可能是由于数据格式不兼容或网络波动导致的。
                    <br/>
                    <span className="text-xs opacity-75 font-mono mt-2 block bg-red-100 p-2 rounded break-all">
                        {this.state.error?.message}
                    </span>
                </p>
                <button 
                    onClick={() => window.location.reload()}
                    className="px-6 py-2.5 bg-red-600 text-white text-sm font-bold rounded-xl hover:bg-red-700 transition-colors flex items-center gap-2 mx-auto shadow-lg shadow-red-200"
                >
                    <RefreshCcw size={16} /> 刷新页面重试
                </button>
            </div>
        </div>
      );
    }

    return this.props.children;
  }
}
