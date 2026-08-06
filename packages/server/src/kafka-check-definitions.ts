export type KafkaTopicKey = 'transLogV1' | 'refundLog' | 'paymentAuth';

export const KAFKA_TOPIC_KEYS: KafkaTopicKey[] = ['transLogV1', 'refundLog', 'paymentAuth'];

export interface KafkaTopicDefinition {
  correlatorField: string;
  hasDataWrapper: boolean;
  requiredFields: string[];
}

export const KAFKA_TOPIC_DEFINITIONS: Record<KafkaTopicKey, KafkaTopicDefinition> = {
  transLogV1: {
    correlatorField: 'appTransID',
    hasDataWrapper: true,
    requiredFields: [
      'transID', 'appID', 'transType', 'pmcID', 'amount', 'userChargeAmount', 'userFeeAmount',
      'transStatus', 'status', 'userID', 'appTransID', 'isFullFlow', 'authInfo', 'merchantCategoryCode',
      'productType', 'orderNo', 'paymentNo', 'paymentMethod', 'destTxnStatus', 'sourceTxnStatus',
      'destAssetType', 'destAssetData', 'sourceAssetData',
    ],
  },
  refundLog: {
    correlatorField: 'appTransID',
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
    correlatorField: 'order_no',
    hasDataWrapper: false,
    requiredFields: [
      'payment_no', 'order_no', 'auth_session_id', 'auth_data', 'trans_id', 'fund_type', 'detail_reason',
      'transaction',
    ],
  },
};
