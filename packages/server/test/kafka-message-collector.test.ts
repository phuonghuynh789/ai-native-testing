import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectKafkaMessages, type CollectKafkaMessagesOptions } from '../src/kafka-message-collector.js';

const mocks = vi.hoisted(() => {
  return {
    consumerMock: {
      connect: vi.fn(),
      subscribe: vi.fn(),
      run: vi.fn(),
      on: vi.fn(),
      events: { GROUP_JOIN: 'consumer.group_join' },
      seek: vi.fn(),
      disconnect: vi.fn(),
    },
    adminMock: {
      connect: vi.fn(),
      fetchTopicOffsetsByTimestamp: vi.fn(),
      disconnect: vi.fn(),
    },
    consumerFactory: vi.fn(),
    kafkaConstructorMock: vi.fn(),
  };
});

vi.mock('kafkajs', () => ({
  Kafka: mocks.kafkaConstructorMock,
}));

function captureEachMessage() {
  const calls = mocks.consumerMock.run.mock.calls;
  const call = calls[calls.length - 1];
  if (!call) {
    throw new Error('consumer.run was never called');
  }
  return call[0].eachMessage as (payload: { message: { value: Buffer } }) => Promise<void>;
}

function messagePayload(data: Record<string, unknown>) {
  return { message: { value: Buffer.from(JSON.stringify(data)) } };
}

function baseOptions(overrides: Partial<CollectKafkaMessagesOptions> = {}): CollectKafkaMessagesOptions {
  return {
    brokers: ['broker:9092'],
    topic: 'transLogV1',
    transId: 'tx-1',
    correlatorField: 'appTransID',
    statusField: 'status',
    hasDataWrapper: false,
    terminalStatuses: ['SUCCESS'],
    idleTimeoutMs: 15_000,
    ...overrides,
  };
}

describe('collectKafkaMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumerMock.connect.mockResolvedValue(undefined);
    mocks.consumerMock.subscribe.mockResolvedValue(undefined);
    mocks.consumerMock.run.mockResolvedValue(undefined);
    mocks.consumerMock.disconnect.mockResolvedValue(undefined);
    mocks.adminMock.connect.mockResolvedValue(undefined);
    mocks.adminMock.fetchTopicOffsetsByTimestamp.mockResolvedValue([{ partition: 0, offset: '100' }]);
    mocks.adminMock.disconnect.mockResolvedValue(undefined);
    mocks.consumerFactory.mockReturnValue(mocks.consumerMock);
    mocks.kafkaConstructorMock.mockImplementation(() => ({
      consumer: mocks.consumerFactory,
      admin: () => mocks.adminMock,
    }));
  });

  it('ignores non-matching messages, which do not reset the idle timer, and times out', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();

      await eachMessage(messagePayload({ appTransID: 'some-other-tx', status: 'SUCCESS' }));
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await resultPromise;
      expect(result.messages).toEqual([]);
      expect(result.terminatedBy).toBe('idle-timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('collects a matching message and resolves immediately on a terminal status', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();

      await eachMessage(messagePayload({ appTransID: 'tx-1', status: 'SUCCESS' }));

      const result = await resultPromise;
      expect(result.messages).toEqual([{ appTransID: 'tx-1', status: 'SUCCESS' }]);
      expect(result.receivedStatuses).toEqual(['SUCCESS']);
      expect(result.terminatedBy).toBe('terminal-status');
      expect(mocks.consumerMock.disconnect).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads correlatorField/statusField from inside message.data when hasDataWrapper is true', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions({ hasDataWrapper: true }));
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();

      // A real transLogV1-shaped message: the correlator/status fields are nested under `data`,
      // not top-level — this is exactly the shape that was silently never matching before this fix.
      const wrappedMessage = { logType: 1, data: { appTransID: 'tx-1', status: 'SUCCESS' } };
      await eachMessage({ message: { value: Buffer.from(JSON.stringify(wrappedMessage)) } });

      const result = await resultPromise;
      expect(result.messages).toEqual([wrappedMessage]);
      expect(result.terminatedBy).toBe('terminal-status');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a message with hasDataWrapper true but no usable data object', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions({ hasDataWrapper: true }));
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();

      await eachMessage({ message: { value: Buffer.from(JSON.stringify({ logType: 1 })) } });
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await resultPromise;
      expect(result.messages).toEqual([]);
      expect(result.terminatedBy).toBe('idle-timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the idle timer on each matching non-terminal message, and times out after the last one', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();

      await eachMessage(messagePayload({ appTransID: 'tx-1', status: 'CREATED' }));
      await vi.advanceTimersByTimeAsync(10_000);
      await eachMessage(messagePayload({ appTransID: 'tx-1', status: 'PROCESSING' }));
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await resultPromise;
      expect(result.messages).toHaveLength(2);
      expect(result.receivedStatuses).toEqual(['CREATED', 'PROCESSING']);
      expect(result.terminatedBy).toBe('idle-timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips a message with malformed JSON without crashing', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();

      await eachMessage({ message: { value: Buffer.from('not json') } });
      await vi.advanceTimersByTimeAsync(15_000);

      const result = await resultPromise;
      expect(result.messages).toEqual([]);
      expect(result.terminatedBy).toBe('idle-timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('includes durationMs reflecting elapsed time to termination', async () => {
    vi.useFakeTimers();
    try {
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      const eachMessage = captureEachMessage();
      await vi.advanceTimersByTimeAsync(5_000);
      await eachMessage(messagePayload({ appTransID: 'tx-1', status: 'SUCCESS' }));

      const result = await resultPromise;
      expect(result.durationMs).toBeGreaterThanOrEqual(5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('seeks each partition to the resolved offset once the consumer group joins', async () => {
    vi.useFakeTimers();
    try {
      mocks.adminMock.fetchTopicOffsetsByTimestamp.mockResolvedValue([
        { partition: 0, offset: '250' },
        { partition: 1, offset: '300' },
      ]);
      const resultPromise = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);

      const onCall = mocks.consumerMock.on.mock.calls.find(
        ([eventName]) => eventName === mocks.consumerMock.events.GROUP_JOIN
      );
      expect(onCall).toBeDefined();
      onCall![1]();

      expect(mocks.consumerMock.seek).toHaveBeenCalledWith({ topic: 'transLogV1', partition: 0, offset: '250' });
      expect(mocks.consumerMock.seek).toHaveBeenCalledWith({ topic: 'transLogV1', partition: 1, offset: '300' });

      const eachMessage = captureEachMessage();
      await eachMessage(messagePayload({ appTransID: 'tx-1', status: 'SUCCESS' }));
      await resultPromise;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects when the consumer fails to connect, and still attempts to disconnect', async () => {
    mocks.consumerMock.connect.mockRejectedValue(new Error('connection timeout'));

    await expect(collectKafkaMessages(baseOptions())).rejects.toThrow('connection timeout');
    expect(mocks.consumerMock.disconnect).toHaveBeenCalled();
  });

  it('generates a different group.id for each call', async () => {
    vi.useFakeTimers();
    try {
      const p1 = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      await captureEachMessage()(messagePayload({ appTransID: 'tx-1', status: 'SUCCESS' }));
      await p1;
      const firstGroupId = mocks.consumerFactory.mock.calls[0][0].groupId;

      const p2 = collectKafkaMessages(baseOptions());
      await vi.advanceTimersByTimeAsync(0);
      await captureEachMessage()(messagePayload({ appTransID: 'tx-1', status: 'SUCCESS' }));
      await p2;
      const secondGroupId = mocks.consumerFactory.mock.calls[1][0].groupId;

      expect(firstGroupId).not.toBe(secondGroupId);
    } finally {
      vi.useRealTimers();
    }
  });
});
