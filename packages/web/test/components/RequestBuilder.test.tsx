import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RequestBuilder, type RequestBuilderProps } from '../../src/components/RequestBuilder';
import type { AuthConfig, GrpcFormState } from '../../src/types';

function blankGrpc(): GrpcFormState {
  return {
    protoContent: '',
    protoFilename: '',
    serverAddress: '',
    service: '',
    method: '',
    requestMessage: '',
    metadata: [],
    secure: true,
    skipCertVerification: false,
  };
}

// RequestBuilder is a controlled component: it derives Service/Method
// suggestions from `grpc.protoContent` via an effect, so it only re-derives
// them when that prop actually changes. This wrapper mirrors how App.tsx
// wires onGrpcChange back into state, which the plain `vi.fn()` in baseProps
// does not do on its own.
function ControlledGrpc(props: RequestBuilderProps) {
  const [grpc, setGrpc] = useState(props.grpc);
  return (
    <RequestBuilder
      {...props}
      grpc={grpc}
      onGrpcChange={(next) => {
        setGrpc(next);
        props.onGrpcChange(next);
      }}
    />
  );
}

function baseProps(overrides: Partial<RequestBuilderProps> = {}): RequestBuilderProps {
  return {
    protocol: 'rest',
    onProtocolChange: vi.fn(),
    method: 'GET',
    onMethodChange: vi.fn(),
    url: '',
    onUrlChange: vi.fn(),
    params: [],
    onParamsChange: vi.fn(),
    headers: [],
    onHeadersChange: vi.fn(),
    auth: { type: 'none' } as AuthConfig,
    onAuthChange: vi.fn(),
    body: '',
    onBodyChange: vi.fn(),
    grpc: blankGrpc(),
    onGrpcChange: vi.fn(),
    extracts: [],
    onExtractsChange: vi.fn(),
    questions: [],
    onQuestionsChange: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RequestBuilder', () => {
  it('calls onMethodChange when the method select changes', async () => {
    const onMethodChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onMethodChange })} />);
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'POST');
    expect(onMethodChange).toHaveBeenCalledWith('POST');
  });

  it('calls onUrlChange as the URL input changes', async () => {
    const onUrlChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onUrlChange })} />);
    await userEvent.type(screen.getByLabelText('URL'), 'x');
    expect(onUrlChange).toHaveBeenCalledWith('x');
  });

  it('shows the Params tab by default', () => {
    render(<RequestBuilder {...baseProps({ params: [{ id: '1', key: 'page', value: '2' }] })} />);
    expect(screen.getByDisplayValue('page')).toBeInTheDocument();
  });

  it('switches to the Headers tab', async () => {
    render(<RequestBuilder {...baseProps({ headers: [{ id: '1', key: 'X-Trace', value: 'abc' }] })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Headers' }));
    expect(screen.getByDisplayValue('X-Trace')).toBeInTheDocument();
  });

  it('switches to the Auth tab and shows the token field for bearer auth', async () => {
    render(<RequestBuilder {...baseProps({ auth: { type: 'bearer', token: 'abc' } })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Auth' }));
    expect(screen.getByLabelText('Token')).toHaveValue('abc');
  });

  it('switches auth type via the Type select, resetting to a blank config', async () => {
    const onAuthChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onAuthChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Auth' }));
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'basic');
    expect(onAuthChange).toHaveBeenCalledWith({ type: 'basic', username: '', password: '' });
  });

  it('switches to the Body tab and calls onBodyChange as the textarea changes', async () => {
    const onBodyChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onBodyChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Body' }));
    // '{{}' is user-event's escape for a literal '{' — a bare '{' starts a
    // special-key sequence like '{enter}' in its typing DSL.
    await userEvent.type(screen.getByLabelText('Body (JSON)'), '{{}');
    expect(onBodyChange).toHaveBeenCalledWith('{');
  });

  it('switches to the Extract tab and renders ExtractEditor rows', async () => {
    render(
      <RequestBuilder
        {...baseProps({ extracts: [{ id: '1', source: 'status', path: '', rememberAs: 'code' }] })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Extract' }));
    expect(screen.getByDisplayValue('code')).toBeInTheDocument();
  });

  it('switches to the Questions tab and renders QuestionsEditor rows', async () => {
    render(
      <RequestBuilder
        {...baseProps({ questions: [{ id: '1', source: 'status', path: '', expected: '200' }] })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Questions' }));
    expect(screen.getByLabelText('Expected value')).toHaveValue('200');
  });

  it('switches to the Paste cURL tab and applies a successful import', async () => {
    const onMethodChange = vi.fn();
    const onUrlChange = vi.fn();
    const onHeadersChange = vi.fn();
    const onBodyChange = vi.fn();
    render(
      <RequestBuilder
        {...baseProps({ onMethodChange, onUrlChange, onHeadersChange, onBodyChange })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Paste cURL' }));
    fireEvent.change(screen.getByLabelText('cURL command'), {
      target: { value: `curl -X POST https://api.example.com/x -H 'X-Trace: abc' -d '{"a":1}'` },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onMethodChange).toHaveBeenCalledWith('POST');
    expect(onUrlChange).toHaveBeenCalledWith('https://api.example.com/x');
    expect(onHeadersChange).toHaveBeenCalledWith([
      { id: expect.any(String), key: 'X-Trace', value: 'abc' },
    ]);
    expect(onBodyChange).toHaveBeenCalledWith('{"a":1}');
  });

  it('calls onProtocolChange when the Protocol select changes', async () => {
    const onProtocolChange = vi.fn();
    render(<RequestBuilder {...baseProps({ onProtocolChange })} />);
    await userEvent.selectOptions(screen.getByLabelText('Protocol'), 'grpc');
    expect(onProtocolChange).toHaveBeenCalledWith('grpc');
  });

  it('shows gRPC tabs and hides Paste cURL when protocol is grpc', () => {
    render(<RequestBuilder {...baseProps({ protocol: 'grpc' })} />);
    expect(screen.getByRole('button', { name: 'Proto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Service' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Method' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Metadata' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Paste grpcurl' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Paste cURL' })).not.toBeInTheDocument();
  });

  it('shows Server Address instead of Method/URL when protocol is grpc', async () => {
    const onGrpcChange = vi.fn();
    render(<RequestBuilder {...baseProps({ protocol: 'grpc', onGrpcChange })} />);
    expect(screen.queryByLabelText('Method')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('URL')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Server Address'), 'x');
    expect(onGrpcChange).toHaveBeenCalledWith(expect.objectContaining({ serverAddress: 'x' }));
  });

  it('uploading a .proto file introspects it and populates the Service datalist', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ services: [{ service: 'PaymentService', methods: ['CreatePayment', 'GetPayment'] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const onGrpcChange = vi.fn();
    render(<ControlledGrpc {...baseProps({ protocol: 'grpc', onGrpcChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Proto' }));
    const file = new File(['syntax = "proto3";'], 'payment.proto', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText('Proto File'), file);

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/grpc/introspect', expect.objectContaining({ method: 'POST' }))
    );
    expect(onGrpcChange).toHaveBeenCalledWith(
      expect.objectContaining({ protoContent: 'syntax = "proto3";', protoFilename: 'payment.proto' })
    );

    await userEvent.click(screen.getByRole('button', { name: 'Service' }));
    await vi.waitFor(() => {
      const options = document.querySelectorAll('#grpc-service-options option');
      expect(Array.from(options).map((o) => o.getAttribute('value'))).toEqual(['PaymentService']);
    });
  });

  it('filters Method suggestions to the currently selected Service', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          services: [
            { service: 'PaymentService', methods: ['CreatePayment', 'GetPayment'] },
            { service: 'UserService', methods: ['GetUser'] },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <ControlledGrpc
        {...baseProps({ protocol: 'grpc', grpc: { ...blankGrpc(), service: 'PaymentService' } })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Proto' }));
    const file = new File(['syntax = "proto3";'], 'payment.proto', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText('Proto File'), file);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'Method' }));
    await vi.waitFor(() => {
      const options = document.querySelectorAll('#grpc-method-options option');
      expect(Array.from(options).map((o) => o.getAttribute('value'))).toEqual(['CreatePayment', 'GetPayment']);
    });
  });

  it('switches to the Paste grpcurl tab and applies a successful import', async () => {
    const onGrpcChange = vi.fn();
    render(<RequestBuilder {...baseProps({ protocol: 'grpc', onGrpcChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Paste grpcurl' }));
    fireEvent.change(screen.getByLabelText('grpcurl command'), {
      target: { value: 'grpcurl localhost:50051 payment.PaymentService/CreatePayment' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onGrpcChange).toHaveBeenCalledWith(
      expect.objectContaining({
        serverAddress: 'localhost:50051',
        service: 'PaymentService',
        method: 'CreatePayment',
        secure: true,
        skipCertVerification: false,
      })
    );
  });

  it('re-populates the Service datalist when protoContent arrives via props (e.g. loading a saved step), not just via upload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ services: [{ service: 'PaymentService', methods: ['CreatePayment', 'GetPayment'] }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<RequestBuilder {...baseProps({ protocol: 'grpc' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Service' }));
    expect(document.querySelectorAll('#grpc-service-options option')).toHaveLength(0);

    // Simulate LoadStepSelect restoring a previously-saved gRPC step: protoContent
    // changes via a prop update, never through the file-upload handler.
    rerender(
      <RequestBuilder
        {...baseProps({
          protocol: 'grpc',
          grpc: { ...blankGrpc(), protoContent: 'syntax = "proto3";', protoFilename: 'payment.proto' },
        })}
      />
    );

    await vi.waitFor(() => {
      const options = document.querySelectorAll('#grpc-service-options option');
      expect(Array.from(options).map((o) => o.getAttribute('value'))).toEqual(['PaymentService']);
    });

    // Switching to a different saved step (protoContent changes to something
    // else that fails to introspect) must clear the stale suggestions rather
    // than leaving PaymentService's options showing.
    fetchMock.mockResolvedValueOnce({ ok: false });
    rerender(
      <RequestBuilder
        {...baseProps({
          protocol: 'grpc',
          grpc: { ...blankGrpc(), protoContent: 'not a valid proto', protoFilename: 'other.proto' },
        })}
      />
    );

    await vi.waitFor(() => {
      const options = document.querySelectorAll('#grpc-service-options option');
      expect(options).toHaveLength(0);
    });
  });

  it('renders the Secure and Skip certificate verification checkboxes with their current values', () => {
    render(
      <RequestBuilder
        {...baseProps({
          protocol: 'grpc',
          grpc: { ...blankGrpc(), secure: true, skipCertVerification: false },
        })}
      />
    );
    expect(screen.getByLabelText('Secure (TLS)')).toBeChecked();
    expect(screen.getByLabelText('Skip certificate verification')).not.toBeChecked();
    expect(screen.getByLabelText('Skip certificate verification')).toBeEnabled();
  });

  it('disables Skip certificate verification when Secure is off', () => {
    render(
      <RequestBuilder
        {...baseProps({ protocol: 'grpc', grpc: { ...blankGrpc(), secure: false } })}
      />
    );
    expect(screen.getByLabelText('Skip certificate verification')).toBeDisabled();
  });

  it('calls onGrpcChange when the Secure checkbox is toggled', async () => {
    const onGrpcChange = vi.fn();
    render(
      <RequestBuilder
        {...baseProps({
          protocol: 'grpc',
          onGrpcChange,
          grpc: { ...blankGrpc(), secure: true },
        })}
      />
    );
    await userEvent.click(screen.getByLabelText('Secure (TLS)'));
    expect(onGrpcChange).toHaveBeenCalledWith(expect.objectContaining({ secure: false }));
  });

  it('calls onGrpcChange when Skip certificate verification is toggled', async () => {
    const onGrpcChange = vi.fn();
    render(
      <RequestBuilder
        {...baseProps({
          protocol: 'grpc',
          onGrpcChange,
          grpc: { ...blankGrpc(), secure: true, skipCertVerification: false },
        })}
      />
    );
    await userEvent.click(screen.getByLabelText('Skip certificate verification'));
    expect(onGrpcChange).toHaveBeenCalledWith(expect.objectContaining({ skipCertVerification: true }));
  });
});
