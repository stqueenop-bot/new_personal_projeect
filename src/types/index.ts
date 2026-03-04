// ================================
// ZapUPI API Types
// ================================

export interface ZapUPICreateOrderResponse {
    status: 'success' | 'error';
    message: string;
    payment_url?: string;
    order_id?: string;
}

export interface ZapUPIOrderStatusData {
    custumer_mobile: string;
    utr: string;
    remark: string;
    txn_id: string;
    create_at: string;
    order_id: string;
    status: 'success' | 'Success' | 'pending' | 'failed' | 'Failed';
    amount: number;
}

export interface ZapUPIOrderStatusResponse {
    status: 'success' | 'error';
    message?: string;
    data?: ZapUPIOrderStatusData;
}

// ================================
// SSM Panel API Types
// ================================

export interface SmmService {
    service: number;
    name: string;
    type: string;
    category: string;
    rate: string;
    min: string;
    max: string;
    description?: string;
    dripfeed: boolean;
    refill: boolean;
    cancel: boolean;
}

export interface SmmAddOrderResponse {
    order?: number;
    error?: string;
}

export interface SmmOrderStatusResponse {
    charge?: string;
    start_count?: string;
    status?: string;
    remains?: string;
    currency?: string;
    error?: string;
}

export interface SmmBalanceResponse {
    balance?: string;
    currency?: string;
    error?: string;
}

// ================================
// RabbitMQ Message Types
// ================================

export interface PaymentSuccessMessage {
    orderId: string;
    paymentId: string;
    serviceId: number;
    link: string;
    quantity: number;
    amount: number;
    utr: string;
    customerMobile?: string;
    timestamp: string;
}

export interface PaymentFailedMessage {
    orderId: string;
    paymentId: string;
    amount: number;
    reason: string;
    customerMobile?: string;
    timestamp: string;
}

// ================================
// Request Body Types
// ================================

export interface CreateOrderBody {
    serviceId: number;
    link: string;
    quantity: number;
    amount: number;
    customerMobile?: string;
    remark?: string;
    userId?: string;
}

export interface ZapUPIWebhookBody {
    order_id: string;
    status: string;
    utr?: string;
    txn_id?: string;
    amount?: number;
    reason?: string;
}

// ================================
// API Response Wrapper
// ================================

export interface ApiResponse<T = unknown> {
    success: boolean;
    message: string;
    data?: T;
    error?: string;
}
