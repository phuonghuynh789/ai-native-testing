export type KafkaTopicKey = 'transLogV1' | 'refundLog' | 'paymentAuth';

export const KAFKA_TOPIC_KEYS: KafkaTopicKey[] = ['transLogV1', 'refundLog', 'paymentAuth'];

export interface KafkaTopicDefinition {
  correlatorFields: string[];
  hasDataWrapper: boolean;
  requiredFields?: string[];
  diffIgnoreFields?: string[];
}

export const KAFKA_TOPIC_DEFINITIONS: Record<KafkaTopicKey, KafkaTopicDefinition> = {
  transLogV1: {
    correlatorFields: ['appTransID', 'transID'],
    hasDataWrapper: true,
  },
  refundLog: {
    correlatorFields: ['appTransID', 'transID'],
    hasDataWrapper: true,
    requiredFields: [
      'transID', 'appID', 'appTransID', 'transType', 'pmcID', 'amount', 'userChargeAmount', 'userFeeAmount',
      'transStatus', 'bankCode', 'ccBankCode', 'refundType', 'refundStatus', 'internalRefundStatus',
      'refundCaller', 'refundAmount', 'requestRefundAmount', 'requestRefundFeeAmount', 'refundReasonType',
      'refundResponse', 'refundID', 'refundBeginDate', 'refundEndDate', 'mRefundID', 'isRefundByChargeAmount',
      'callApiBeginDate', 'callApiEndDate', 'isFinal', 'discountAmount', 'remainingAmount', 'userId',
      'refundDescription', 'applyRevamp', 'promotionRefundAmount', 'userFeeRefundAmount', 'productCode',
      'eventCode', 'mcc', 'additionalTransInfo', 'eventContext', 'paymentNo', 'status', 'internalStatus',
    ],
  },
  paymentAuth: {
    correlatorFields: ['order_no'],
    hasDataWrapper: false,
    requiredFields: [
      'payment_no', 'order_no', 'auth_session_id', 'auth_data', 'trans_id', 'fund_type', 'detail_reason',
      'transaction',
    ],
  },
};
