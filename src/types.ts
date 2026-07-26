// CDP Types for Browsy Plugin
// Based on Chrome DevTools Protocol

export interface CDPSession {
  id: string;
  url?: string;
}

// Base CDP message structure
export interface CDPMessage<R = any> {
  id?: number;
  method: string;
  params?: R;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// Page Domain
export namespace Page {
  export interface NavigateParams {
    url: string;
    referrer?: string;
    transitionType?: 'link' | 'typed' | 'auto_bookmark' | 'auto_subframe' | 'manual' | 'generated' | 'auto_toplevel' | 'form_submit';
    frameId?: string;
  }

  export interface NavigateResult {
    frameId: string;
    loaderId: string;
    // Note: errorText if navigation failed
    errorText?: string;
  }

  export interface CaptureScreenshotParams {
    format?: 'png' | 'jpeg';
    quality?: number; // 0-100 for jpeg
    clip?: {
      x: number;
      y: number;
      width: number;
      height: number;
      scale?: number;
    };
    fromSurface?: boolean;
  }

  export interface CaptureScreenshotResult {
    data: string; // base64-encoded image data
  }

  export interface GetLayoutMetricsResult {
    contentSize: {
      width: number;
      height: number;
    };
    visibleSize: {
      width: number;
      height: number;
    };
    layoutSize: {
      width: number;
      height: number;
    };
    visualViewport: {
      pageX: number;
      pageY: number;
      scale: number;
      width: number;
      height: number;
      offsetX: number;
      offsetY: number;
    };
  }
}

// Runtime Domain
export namespace Runtime {
  export interface EvaluateParams {
    expression: string;
    objectGroup?: string;
    includeCommandLineAPI?: boolean;
    silent?: boolean;
    contextId?: number;
    returnByValue?: boolean;
    generatePreview?: boolean;
    userGesture?: boolean;
    awaitPromise?: boolean;
    allowUnsafeEvalBlockedByCSP?: boolean;
  }

  export interface EvaluateResult {
    result: RemoteObject;
    exceptionDetails?: ExceptionDetails;
  }

  export interface RemoteObject {
    type: 'object' | 'function' | 'undefined' | 'string' | 'number' | 'boolean' | 'symbol';
    subtype?: 'array' | 'null' | 'node' | 'regexp' | 'date' | 'map' | 'set' | 'weakmap' | 'weakset' | 'iterator' | 'generator' | 'error' | 'proxy' | 'proxy' | 'arraybuffer' | 'dataview' | 'typedarray' | 'arraybuffer' | 'promise';
    className?: string;
    value?: any; // Primitive values or null
    description?: string; // For object, function, symbol
    objectId?: string; // For object or function
    unserializableValue?: number; // 0: -0, 1: NaN, 2: Infinity, 3: -Infinity
  }

  export interface ExceptionDetails {
    exceptionId?: number;
    text: string;
    lineNumber?: number;
    columnNumber?: number;
    url?: string;
    stackTrace?: StackTrace;
    executionContextId?: number;
  }

  export interface StackTrace {
    description?: string;
    callFrames: CallFrame[];
  }

  export interface CallFrame {
    functionName: string;
    scriptId: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  }
}

// Performance Domain
export namespace Performance {
  export interface EnableResult {}
  export interface DisableResult {}
  export interface GetMetricsResult {
    metrics: Metric[];
  }

  export interface Metric {
    name: string;
    value: number;
  }
}

// Accessibility Domain
export namespace Accessibility {
  export interface GetFullAXTreeParams {
    // No parameters currently
  }

  export interface GetFullAXTreeResult {
    nodes: AXNode[];
  }

  export interface AXNode {
    nodeId: string;
    ignored?: boolean;
    ignoredReasons?: AXProperty[];
    role?: AXProperty;
    value?: AXValue;
    name?: AXProperty[];
    description?: AXProperty[];
    valueForName?: AXProperty[];
    placeholder?: AXProperty[];
    readonly?: AXProperty[];
    disabled?: AXProperty[];
    expanded?: AXProperty[];
    editable?: AXProperty[];
    multiline?: AXProperty[];
    selectable?: AXProperty[];
    selected?: AXProperty[];
    checked?: AXProperty[];
    pressed?: AXProperty[];
    focusable?: AXProperty[];
    focused?: AXProperty[];
    modal?: AXProperty[];
    hasPopup?: AXProperty[];
    invalid?: AXProperty[];
    keyshortcuts?: AXProperty[];
    // ... (other properties as needed)
  }

  export interface AXProperty {
    name: string;
    value: string | number | boolean;
  }

  export interface AXValue {
    type: string;
    value?: string | number | boolean;
    // ... (other properties as needed)
  }
}

// Generic CDP Domain Handler
export interface CDPDomain {
  handleMessage(message: CDPMessage): void;
}

// Connection Status
export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  CLOSED = 'closed'
}