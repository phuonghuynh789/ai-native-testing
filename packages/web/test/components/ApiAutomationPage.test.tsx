import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ApiAutomationPage } from '../../src/components/ApiAutomationPage';
import type { FormState } from '../../src/types';

function makeGrpcForm(service: string, method: string, taskName: string): FormState {
  return {
    actorName: '',
    taskName,
    variables: [],
    protocol: 'grpc',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: 'syntax = "proto3";',
      protoFilename: 'service.proto',
      serverAddress: 'localhost:50051',
      service,
      method,
      requestMessage: '{}',
      metadata: [],
      secure: true,
      skipCertVerification: false,
    },
    extracts: [],
    questions: [],
  };
}

function makeRestForm(taskName: string): FormState {
  return {
    actorName: '',
    taskName,
    variables: [],
    protocol: 'rest',
    method: 'GET',
    url: 'https://example.com',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: '',
    grpc: {
      protoContent: '',
      protoFilename: '',
      serverAddress: '',
      service: '',
      method: '',
      requestMessage: '',
      metadata: [],
      secure: true,
      skipCertVerification: false,
    },
    extracts: [],
    questions: [],
  };
}

const STEPS: Record<string, FormState> = {
  'grpc step A': makeGrpcForm('PaymentService', 'CreatePayment', 'Task A'),
  'grpc step B': makeGrpcForm('UserProfile', 'QueryByPhone', 'Task B'),
  'grpc step D': makeGrpcForm('UserProfile', 'UpdateProfile', 'Task D'),
  'rest step C': makeRestForm('Task C'),
};

const FLOWS: Record<string, string[]> = {
  'Flow One': ['grpc step A', 'grpc step D'],
  'Flow Two': ['grpc step D'],
};

function stubFetch() {
  return vi.fn((url: string) => {
    if (url.startsWith('/steps/')) {
      const name = decodeURIComponent(url.replace('/steps/', ''));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(STEPS[name]) });
    }
    if (url.startsWith('/flows/')) {
      const name = decodeURIComponent(url.replace('/flows/', ''));
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FLOWS[name] ?? []) });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

const STEP_NAMES = Object.keys(STEPS);
const FLOW_NAMES = Object.keys(FLOWS);

function renderPage(onFormChange = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={['/api-automation']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route
          path="/api-automation"
          element={<ApiAutomationPage stepNames={STEP_NAMES} flowNames={FLOW_NAMES} onFormChange={onFormChange} />}
        />
        <Route path="/" element={<div>Landed on Simple Mode</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ApiAutomationPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists only gRPC steps, excluding REST steps', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderPage();

    expect(await screen.findByRole('button', { name: /grpc step A/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /grpc step B/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /grpc step D/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rest step C/ })).not.toBeInTheDocument();
  });

  it('shows correct flow membership badges', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderPage();

    expect(await screen.findByRole('button', { name: /grpc step A/ })).toHaveTextContent('Flow One');
    expect(screen.getByRole('button', { name: /grpc step B/ })).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: /grpc step D/ })).toHaveTextContent('Flow One, Flow Two');
  });

  it('filters by Service', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.type(screen.getByLabelText('Service'), 'Payment');

    expect(screen.getByRole('button', { name: /grpc step A/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /grpc step B/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /grpc step D/ })).not.toBeInTheDocument();
  });

  it('narrows Method suggestions to the selected Service', async () => {
    vi.stubGlobal('fetch', stubFetch());
    const { container } = renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.type(screen.getByLabelText('Service'), 'UserProfile');

    const methodOptions = Array.from(
      container.querySelectorAll('#api-automation-method-options option')
    ).map((option) => option.getAttribute('value'));
    expect(methodOptions.sort()).toEqual(['QueryByPhone', 'UpdateProfile']);
  });

  it('filters by E2E flow', async () => {
    vi.stubGlobal('fetch', stubFetch());
    renderPage();
    await screen.findByRole('button', { name: /grpc step A/ });

    await userEvent.type(screen.getByLabelText('E2E flow'), 'Flow Two');

    expect(screen.getByRole('button', { name: /grpc step D/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /grpc step A/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /grpc step B/ })).not.toBeInTheDocument();
  });

  it('loads the clicked step into the form and navigates to Simple Mode', async () => {
    const onFormChange = vi.fn();
    vi.stubGlobal('fetch', stubFetch());
    renderPage(onFormChange);

    await userEvent.click(await screen.findByRole('button', { name: /grpc step A/ }));

    expect(onFormChange).toHaveBeenCalledWith(STEPS['grpc step A']);
    expect(await screen.findByText('Landed on Simple Mode')).toBeInTheDocument();
  });
});
