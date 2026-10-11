import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuickGuideModal from './QuickGuideModal';

describe('QuickGuideModal Component - Manual de Usuario Interactivo', () => {
  it('does not render when isOpen is false', () => {
    render(<QuickGuideModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('quick-guide-modal')).toBeNull();
  });

  it('renders title, ASCII map, all 6 modules and 3 steps when isOpen is true', () => {
    render(<QuickGuideModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('quick-guide-modal')).toBeTruthy();
    expect(screen.getByText('⚡ Auto Switcher Pro · Guía Rápida')).toBeTruthy();
    expect(screen.getByText('Mapa de Arquitectura & Submenús')).toBeTruthy();

    // Verify presence of all modules in order
    expect(screen.getByText('🛠️ 1. Crear Group / Perfiles')).toBeTruthy();
    expect(screen.getByText('🗂️ 2. Auto Auth Files')).toBeTruthy();
    expect(screen.getByText('♊ 3. Control Switcher')).toBeTruthy();
    expect(screen.getByText('🔵 4. Visual Profile')).toBeTruthy();
    expect(screen.getByText('🏷️ 5. Pulse Tokens')).toBeTruthy();
    expect(screen.getByText('📋 6. Directorio de Cuentas')).toBeTruthy();
    expect(screen.getByText('🩺 7. Salud & Mantenimiento')).toBeTruthy();

    // Verify 3-step quick flow
    expect(screen.getByText('Flujo Rápido Recomendado (En 3 Pasos)')).toBeTruthy();
  });

  it('calls onClose when close button or bottom button is clicked', () => {
    const handleClose = vi.fn();
    render(<QuickGuideModal isOpen={true} onClose={handleClose} />);

    fireEvent.click(screen.getByTestId('btn-close-guide'));
    expect(handleClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('btn-guide-bottom-close'));
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it('calls onClose when clicking outside overlay', () => {
    const handleClose = vi.fn();
    render(<QuickGuideModal isOpen={true} onClose={handleClose} />);

    fireEvent.click(screen.getByTestId('quick-guide-overlay'));
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
