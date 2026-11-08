// CDP Types for Browsy
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

// Target Domain
export namespace Target {
  export interface TargetInfo {
    targetId: string;
    type: 'page' | 'service_worker' | 'shared_worker' | 'browser' | 'other' | 'background_page' | 'iframe';
    title: string;
    url: string;
    attached?: boolean;
    canAttach?: boolean;
    parentId?: string;
  }

  export interface GetTargetsResult {
    targetInfos: TargetInfo[];
  }

  export interface CreateTargetResult {
    targetId: string;
  }

  export interface CloseTargetResult {
    success: boolean;
  }
}

// Input Domain (trusted events)
export namespace Input {
  export interface DispatchMouseEventParams {
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel' | 'mouseWheelGesture';
    modifiers?: number;
    x: number;
    y: number;
    /** Mouse button name (CDP is case-sensitive: 'left' | 'middle' | 'right'). */
    button?: 'left' | 'middle' | 'right' | 'back' | 'forward';
    /** Bitmask of currently-pressed buttons. */
    buttons?: number;
    clickCount?: number;
    /** Pixel size of the press (0 = unknown, e.g. for a keyboard-driven click). */
    radiusX?: number;
    radiusY?: number;
  }
  export interface InsertTextParams {
    text: string;
  }
}

// DOM Domain (for element → node → box-model resolution in trusted input)
export namespace DOM {
  export interface QuerySelectorResult {
    nodeId: number;
  }
  export interface GetBoxModelResult {
    model: {
      content: number[];
      border: number[];
      padding: number[];
      margin: number[];
    };
  }
  export interface ResolveNodeResult {
    object: unknown;
  }
}

// Console capture record
export interface ConsoleEntry {
  type: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'exception' | string;
  text: string;
  timestamp?: number;
}

// Network capture record
export interface NetworkEntry {
  requestId: string;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  resourceType?: string;
}

// Network Domain - Interception
export namespace Network {
  export interface RequestPattern {
    urlPattern: string;
    resourceType?: string;
    requestStage?: 'Request' | 'Response';
  }

  export interface SetRequestInterceptionParams {
    patterns: RequestPattern[];
  }

  export interface RequestInterceptedEvent {
    interceptionId: string;
    request: Request;
    frameId: string;
    resourceType: string;
    isNavigationRequest: boolean;
    redirectUrl?: string;
    authChallenge?: AuthChallenge;
    responseErrorReason?: string;
    responseStatusCode?: number;
    responseHeaders?: Record<string, string>;
  }

  export interface Request {
    requestId: string;
    loaderId: string;
    documentURL: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
    hasPostData: boolean;
    resourceType: string;
    priority: string;
  }

  export interface AuthChallenge {
    source: 'Server' | 'Proxy';
    origin: string;
    scheme: string;
    realm?: string;
  }

  export interface ContinueInterceptedRequestParams {
    interceptionId: string;
    errorReason?: 'Failed' | 'Aborted' | 'TimedOut' | 'AccessDenied' | 'ConnectionClosed' | 'ConnectionReset' | 'ConnectionRefused' | 'ConnectionAborted' | 'ConnectionFailed' | 'NameNotResolved' | 'InternetDisconnected' | 'AddressUnreachable' | 'BlockedByClient' | 'BlockedByResponse';
    rawResponse?: string;
    url?: string;
    method?: string;
    postData?: string;
    headers?: Record<string, string>;
  }

  export interface ContinueInterceptedRequestResult {}

  export interface SetResponseOverrideParams {
    urlPattern: string;
    response: {
      status: number;
      headers?: Record<string, string>;
      body?: string;
      contentType?: string;
    };
  }

  export interface Cookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    expires?: number;
    size?: number;
    priority?: 'Low' | 'Medium' | 'High';
  }

  export interface GetCookiesResult {
    cookies: Cookie[];
  }

  export interface SetCookieParams {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
    expires?: number;
  }

  export interface SetCookieResult {
    success: boolean;
  }

  export interface DeleteCookiesParams {
    name: string;
    domain?: string;
    path?: string;
  }
}

// Fetch Domain (for more advanced interception)
export namespace Fetch {
  export interface RequestPattern {
    urlPattern: string;
    requestStage?: 'Request' | 'Response';
    resourceType?: string;
  }

  export interface EnableParams {
    patterns?: RequestPattern[];
    handleAuthRequests?: boolean;
  }

  export interface RequestPausedEvent {
    requestId: string;
    request: Network.Request;
    frameId: string;
    resourceType: string;
    responseErrorReason?: string;
    responseStatusCode?: number;
    responseHeaders?: Record<string, string>;
    interceptionId?: string;
  }

  export interface FailRequestParams {
    requestId: string;
    errorReason: 'Failed' | 'Aborted' | 'TimedOut' | 'AccessDenied' | 'ConnectionClosed' | 'ConnectionReset' | 'ConnectionRefused' | 'ConnectionAborted' | 'ConnectionFailed' | 'NameNotResolved' | 'InternetDisconnected' | 'AddressUnreachable' | 'BlockedByClient' | 'BlockedByResponse';
  }

  export interface FulfillRequestParams {
    requestId: string;
    responseCode: number;
    responseHeaders?: Array<{ name: string; value: string }>;
    body?: string;
    responsePhrase?: string;
  }

  export interface ContinueRequestParams {
    requestId: string;
    url?: string;
    method?: string;
    postData?: string;
    headers?: Array<{ name: string; value: string }>;
  }

  export interface ContinueWithAuthParams {
    requestId: string;
    authChallengeResponse: {
      response: 'Default' | 'CancelAuth' | 'ProvideCredentials';
      username?: string;
      password?: string;
    };
  }
}

// Generic CDP Domain Handler
export interface CDPDomain {
  handleMessage(message: CDPMessage): void;
}

// Shape of the CDP HTTP `/json/version` endpoint response.
export interface CDPBrowserInfo {
  Browser: string;
  'Protocol-Version': string;
  webSocketDebuggerUrl?: string;
  [key: string]: unknown;
}

// Shape of an entry from the CDP HTTP `/json/list` endpoint (used to
// auto-discover page targets and list open tabs). Note this is the HTTP
// shape — `id` — which matches the CDP `targetId` string.
export interface TargetListEntry {
  id: string;
  type: string;
  url: string;
  title?: string;
}

// Connection Status
export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  CLOSED = 'closed'
}
