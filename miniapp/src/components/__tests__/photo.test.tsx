import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Photo } from '@/components/Photo';

const HEX = '0123456789abcdef0123456789abcdef';
const ORIGINAL = `https://api.flrt.md/media/photos/u1/${HEX}.jpg`;
const V256 = `https://api.flrt.md/media/photos/u1/${HEX}_256.webp`;

describe('<Photo>', () => {
  it('cere varianta, lazy + async implicit', () => {
    render(<Photo src={ORIGINAL} size={256} alt="avatar" />);
    const img = screen.getByAltText('avatar');
    expect(img).toHaveAttribute('src', V256);
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveAttribute('fetchpriority', 'auto');
  });

  it('priority → eager + fetchpriority high', () => {
    render(<Photo src={ORIGINAL} size={800} priority alt="card" className="c" />);
    const img = screen.getByAltText('card');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveClass('c');
  });

  it('fără size folosește originalul', () => {
    render(<Photo src={ORIGINAL} alt="full" />);
    expect(screen.getByAltText('full')).toHaveAttribute('src', ORIGINAL);
  });

  it('la eroare trece O SINGURĂ DATĂ pe original, apoi cheamă onError', () => {
    const onError = vi.fn();
    render(<Photo src={ORIGINAL} size={256} alt="p" onError={onError} />);
    const img = screen.getByAltText('p');

    fireEvent.error(img);
    expect(img).toHaveAttribute('src', ORIGINAL);
    expect(onError).not.toHaveBeenCalled();

    fireEvent.error(img);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(img).toHaveAttribute('src', ORIGINAL);
  });

  it('URL extern (fără variantă): onError direct, fără reîncercare', () => {
    const onError = vi.fn();
    const ext = 'https://t.me/i/userpic/320/a.jpg';
    render(<Photo src={ext} size={256} alt="tg" onError={onError} />);
    const img = screen.getByAltText('tg');
    expect(img).toHaveAttribute('src', ext);
    fireEvent.error(img);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('la schimbarea src încearcă din nou varianta', () => {
    const other = `https://api.flrt.md/media/photos/u1/${'f'.repeat(32)}.jpg`;
    const { rerender } = render(<Photo src={ORIGINAL} size={256} alt="r" />);
    fireEvent.error(screen.getByAltText('r'));
    expect(screen.getByAltText('r')).toHaveAttribute('src', ORIGINAL);

    rerender(<Photo src={other} size={256} alt="r" />);
    expect(screen.getByAltText('r')).toHaveAttribute(
      'src',
      `https://api.flrt.md/media/photos/u1/${'f'.repeat(32)}_256.webp`,
    );
  });
});
