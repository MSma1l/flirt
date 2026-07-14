import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Alert, AlertButton } from 'react-native';

import { PhotoGrid } from '../PhotoGrid';
import { moveItem } from '../reorder';
import { PhotoTile } from '../types';
import { ThemeProvider } from '@theme/index';

function tiles(...uris: string[]): PhotoTile[] {
  return uris.map((uri) => ({ key: uri, uri }));
}

interface Handlers {
  onAdd?: () => void;
  onRemove?: (index: number) => void;
  onMove?: (from: number, to: number) => void;
  onOpenSettings?: () => void;
}

function renderGrid(
  photos: PhotoTile[],
  handlers: Handlers = {},
  extra: { error?: string | null; permissionDenied?: boolean } = {},
) {
  return render(
    <ThemeProvider>
      <PhotoGrid
        photos={photos}
        onAdd={handlers.onAdd ?? jest.fn()}
        onRemove={handlers.onRemove ?? jest.fn()}
        onMove={handlers.onMove ?? jest.fn()}
        onOpenSettings={handlers.onOpenSettings ?? jest.fn()}
        error={extra.error}
        permissionDenied={extra.permissionDenied}
      />
    </ThemeProvider>,
  );
}

describe('PhotoGrid', () => {
  afterEach(() => jest.restoreAllMocks());

  it('marchează vizibil prima poză drept principală', () => {
    const { getAllByTestId, getByLabelText } = renderGrid(tiles('a.jpg', 'b.jpg'));

    expect(getAllByTestId('photo-main-badge')).toHaveLength(1);
    expect(getByLabelText('Poza principală')).toBeTruthy();
  });

  it('arată câte poze sunt și care e minimul', () => {
    const { getByText } = renderGrid(tiles('a.jpg'));
    expect(getByText('Poze (1/9) — minimum 3. Prima poză este cea principală.')).toBeTruthy();
  });

  it('ștergerea cere confirmare; „Anulează" nu șterge nimic', () => {
    const onRemove = jest.fn();
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

    const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg'), { onRemove });
    fireEvent.press(getByTestId('photo-remove-0'));

    expect(Alert.alert).toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled(); // fără confirmare → fără ștergere
  });

  it('ștergerea se produce doar după confirmarea explicită', () => {
    const onRemove = jest.fn();
    jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_title, _message, buttons?: AlertButton[]) => {
        buttons?.find((b) => b.style === 'destructive')?.onPress?.();
      });

    const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg'), { onRemove });
    fireEvent.press(getByTestId('photo-remove-1'));

    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('reordonarea trimite indecșii corecți (a doua poză devine principală)', () => {
    const onMove = jest.fn();
    const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg', 'c.jpg'), { onMove });

    fireEvent.press(getByTestId('photo-move-left-1'));

    expect(onMove).toHaveBeenCalledWith(1, 0);
    // Ordinea rezultată — prima poză (principala) devine `b.jpg`.
    expect(moveItem(['a.jpg', 'b.jpg', 'c.jpg'], 1, 0)).toEqual([
      'b.jpg',
      'a.jpg',
      'c.jpg',
    ]);
  });

  it('nu poți muta prima poză mai la stânga, nici ultima mai la dreapta', () => {
    const onMove = jest.fn();
    const { getByTestId } = renderGrid(tiles('a.jpg', 'b.jpg'), { onMove });

    fireEvent.press(getByTestId('photo-move-left-0'));
    fireEvent.press(getByTestId('photo-move-right-1'));

    expect(onMove).not.toHaveBeenCalled();
  });

  it('afișează progresul uploadului pe poza în curs', () => {
    const { getByTestId, getByText } = renderGrid([
      { key: 'a.jpg', uri: 'a.jpg', uploading: true, progress: 0.42 },
    ]);

    expect(getByTestId('photo-progress-0')).toBeTruthy();
    expect(getByText('42%')).toBeTruthy();
  });

  it('la maximul de poze ascunde butonul de adăugare și explică de ce', () => {
    const uris = Array.from({ length: 9 }, (_, i) => `p${i}.jpg`);
    const { queryByTestId, getByText } = renderGrid(tiles(...uris));

    expect(queryByTestId('photo-add')).toBeNull();
    expect(getByText('Ai atins numărul maxim de 9 poze.')).toBeTruthy();
  });

  it('permisiune refuzată → mesaj + buton de recuperare „Deschide setările"', () => {
    const onOpenSettings = jest.fn();
    const { getByText, getByTestId } = renderGrid(
      [],
      { onOpenSettings },
      { permissionDenied: true, error: 'Nu avem acces la galerie.' },
    );

    expect(getByText('Nu avem acces la galerie.')).toBeTruthy();
    fireEvent.press(getByTestId('photo-open-settings'));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe('moveItem', () => {
  it('mută elementul și lasă lista originală neatinsă', () => {
    const original = ['a', 'b', 'c'];
    expect(moveItem(original, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(original).toEqual(['a', 'b', 'c']);
  });

  it('ignoră indecșii invalizi', () => {
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], -1, 0)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});
