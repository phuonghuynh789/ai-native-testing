import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManageStepsPage } from '../../src/components/ManageStepsPage';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(handlers: Record<string, unknown>) {
  return vi.fn((url: string, init?: RequestInit) => {
    const key = init?.method ? `${init.method} ${url}` : url;
    const entry = handlers[key] ?? handlers[url];
    if (entry === undefined) {
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve(entry) });
  });
}

function baseProps(overrides: Partial<Parameters<typeof ManageStepsPage>[0]> = {}) {
  return {
    stepNames: ['Create Payment'],
    onStepNamesChange: vi.fn(),
    flowNames: [],
    onFlowNamesChange: vi.fn(),
    ...overrides,
  };
}

describe('ManageStepsPage — Steps tab', () => {
  it('loads and renders page 1 of steps on mount', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/steps/search?search=&page=1&pageSize=20': {
          items: [
            { name: 'Create Payment', protocol: 'rest', method: 'POST', url: 'https://x.com', grpcService: '', grpcMethod: '' },
          ],
          total: 1,
        },
      })
    );

    render(<ManageStepsPage {...baseProps()} />);

    expect(await screen.findByText('Create Payment')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('https://x.com')).toBeInTheDocument();
  });

  it('shows an empty state when there are no matches', async () => {
    vi.stubGlobal('fetch', stubFetch({ '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 } }));
    render(<ManageStepsPage {...baseProps()} />);
    expect(await screen.findByText('No reusable steps found.')).toBeInTheDocument();
  });

  it('searches by the entered term when Search is clicked', async () => {
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 },
      '/steps/search?search=payment&page=1&pageSize=20': {
        items: [{ name: 'Create Payment', protocol: 'rest', method: 'POST', url: 'https://x.com', grpcService: '', grpcMethod: '' }],
        total: 1,
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText('Reusable Step'), 'payment');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Create Payment')).toBeInTheDocument();
  });

  it('paginates with Prev/Next', async () => {
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': { items: [{ name: 'Step A', protocol: 'rest', method: 'GET', url: '', grpcService: '', grpcMethod: '' }], total: 25 },
      '/steps/search?search=&page=2&pageSize=20': { items: [{ name: 'Step B', protocol: 'rest', method: 'GET', url: '', grpcService: '', grpcMethod: '' }], total: 25 },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps()} />);
    expect(await screen.findByText('Step A')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Step B')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
  });

  it('deletes a step with a plain confirm when no flow references it, and updates stepNames', async () => {
    const onStepNamesChange = vi.fn();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': {
        items: [{ name: 'Create Payment', protocol: 'rest', method: 'POST', url: 'https://x.com', grpcService: '', grpcMethod: '' }],
        total: 1,
      },
      '/flows': [],
      'DELETE /steps/Create%20Payment': { names: [] },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps({ onStepNamesChange })} />);
    await screen.findByText('Create Payment');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Create Payment' }));

    expect(window.confirm).toHaveBeenCalledWith("Delete 'Create Payment'?");
    await waitFor(() => expect(onStepNamesChange).toHaveBeenCalledWith([]));
  });

  it('warns which flows reference the step before deleting', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': {
        items: [{ name: 'Create Payment', protocol: 'rest', method: 'POST', url: 'https://x.com', grpcService: '', grpcMethod: '' }],
        total: 1,
      },
      '/flows': ['Checkout Flow'],
      '/flows/Checkout%20Flow': ['Login', 'Create Payment'],
      'DELETE /steps/Create%20Payment': { names: [] },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps()} />);
    await screen.findByText('Create Payment');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Create Payment' }));

    expect(window.confirm).toHaveBeenCalledWith("Used by flows: Checkout Flow. Delete anyway?");
  });

  it('steps back a page when deleting the last remaining row on a page beyond page 1', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': {
        items: [{ name: 'Step A', protocol: 'rest', method: 'GET', url: '', grpcService: '', grpcMethod: '' }],
        total: 21,
      },
      '/steps/search?search=&page=2&pageSize=20': {
        items: [{ name: 'Step B', protocol: 'rest', method: 'GET', url: '', grpcService: '', grpcMethod: '' }],
        total: 21,
      },
      '/flows': [],
      'DELETE /steps/Step%20B': { names: ['Step A'] },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps()} />);
    expect(await screen.findByText('Step A')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Step B')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete Step B' }));

    // Re-fetches page 1 (not page 2, which would now be empty) — proves the page-step-back logic, not just a stale re-render.
    expect(await screen.findByText('Step A')).toBeInTheDocument();
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    const onStepNamesChange = vi.fn();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': {
        items: [{ name: 'Create Payment', protocol: 'rest', method: 'POST', url: 'https://x.com', grpcService: '', grpcMethod: '' }],
        total: 1,
      },
      '/flows': [],
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps({ onStepNamesChange })} />);
    await screen.findByText('Create Payment');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Create Payment' }));

    expect(onStepNamesChange).not.toHaveBeenCalled();
  });
});

describe('ManageStepsPage — Flows tab', () => {
  it('loads and renders page 1 of flows when the Flows tab is opened', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 },
        '/flows/search?search=&page=1&pageSize=20': {
          items: [{ name: 'Checkout Flow', steps: ['Login', 'Create Payment'] }],
          total: 1,
        },
      })
    );

    render(<ManageStepsPage {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Flows' }));

    expect(await screen.findByText('Checkout Flow')).toBeInTheDocument();
    expect(screen.getByText('Login, Create Payment')).toBeInTheDocument();
  });

  it('shows an empty state when there are no flow matches', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch({
        '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 },
        '/flows/search?search=&page=1&pageSize=20': { items: [], total: 0 },
      })
    );

    render(<ManageStepsPage {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Flows' }));

    expect(await screen.findByText('No flows found.')).toBeInTheDocument();
  });

  it('searches flows by the entered term when Search is clicked', async () => {
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 },
      '/flows/search?search=&page=1&pageSize=20': { items: [], total: 0 },
      '/flows/search?search=checkout&page=1&pageSize=20': {
        items: [{ name: 'Checkout Flow', steps: ['Login'] }],
        total: 1,
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Flows' }));
    await waitFor(() => expect(screen.getByText('No flows found.')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('E2E flow'), 'checkout');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Checkout Flow')).toBeInTheDocument();
  });

  it('deletes a flow with a plain confirm and updates flowNames', async () => {
    const onFlowNamesChange = vi.fn();
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    const fetchMock = stubFetch({
      '/steps/search?search=&page=1&pageSize=20': { items: [], total: 0 },
      '/flows/search?search=&page=1&pageSize=20': {
        items: [{ name: 'Checkout Flow', steps: ['Login'] }],
        total: 1,
      },
      'DELETE /flows/Checkout%20Flow': { names: [] },
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ManageStepsPage {...baseProps({ onFlowNamesChange })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Flows' }));
    await screen.findByText('Checkout Flow');

    await userEvent.click(screen.getByRole('button', { name: 'Delete Checkout Flow' }));

    expect(window.confirm).toHaveBeenCalledWith("Delete 'Checkout Flow'?");
    await waitFor(() => expect(onFlowNamesChange).toHaveBeenCalledWith([]));
  });
});
