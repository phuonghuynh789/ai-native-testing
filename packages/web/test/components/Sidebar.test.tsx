import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from '../../src/components/Sidebar';

function renderSidebar(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Sidebar />
    </MemoryRouter>
  );
}

describe('Sidebar', () => {
  it('renders all six nav items with the correct hrefs', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).toHaveAttribute('href', '/manage-steps');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('href', '/e2e-test');
    expect(screen.getByRole('link', { name: 'API Automation' })).toHaveAttribute('href', '/api-automation');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).toHaveAttribute('href', '/kafka-checks');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).toHaveAttribute(
      'href',
      '/kafka-contract-checks'
    );
  });

  it('marks Simple Mode active on the root path', () => {
    renderSidebar('/');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).not.toHaveAttribute('aria-current');
  });

  it('marks Manage Load Reusable Step active on /manage-steps, not the others', () => {
    renderSidebar('/manage-steps');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).not.toHaveAttribute('aria-current');
  });

  it('marks End-to-end test active on /e2e-test, not the others', () => {
    renderSidebar('/e2e-test');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).not.toHaveAttribute('aria-current');
  });

  it('marks API Automation active on /api-automation, not the others', () => {
    renderSidebar('/api-automation');
    expect(screen.getByRole('link', { name: 'API Automation' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).not.toHaveAttribute('aria-current');
  });

  it('marks Check Kafka active on /kafka-checks, not the others', () => {
    renderSidebar('/kafka-checks');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).not.toHaveAttribute('aria-current');
  });

  it('marks Kafka Contract Checks active on /kafka-contract-checks, not the others', () => {
    renderSidebar('/kafka-contract-checks');
    expect(screen.getByRole('link', { name: 'Kafka Contract Checks' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Simple Mode' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Manage Load Reusable Step' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'End-to-end test' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'API Automation' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Check Kafka' })).not.toHaveAttribute('aria-current');
  });
});
