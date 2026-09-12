/**
 * Ecranul de Stories: bara, vizualizatorul, răspunsurile, ștergerea și crearea.
 *
 * Stratul de rețea e izolat la nivelul modulelor proprii (`storiesApi`,
 * `imageResize`), ca testele să verifice DECIZIILE ecranului — ce se cheamă, cu
 * ce argumente și ce vede utilizatorul când ceva cade — nu axios și nu canvas.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Story, UserStories } from '@mobile/features/stories/types';

import { renderWithProviders } from '@/test/harness';

import { StoriesScreen } from '../StoriesScreen';

vi.mock('../storiesApi', () => ({
  fetchStories: vi.fn(),
  fetchMyStories: vi.fn(),
  uploadStoryMedia: vi.fn(),
  createStory: vi.fn(),
  replyToStory: vi.fn(),
  deleteStory: vi.fn(),
}));

vi.mock('../imageResize', () => ({
  prepareStoryImageInBrowser: vi.fn(),
}));

const {
  createStory,
  deleteStory,
  fetchMyStories,
  fetchStories,
  replyToStory,
  uploadStoryMedia,
} = await import('../storiesApi');
const { prepareStoryImageInBrowser } = await import('../imageResize');

const NOW = new Date().toISOString();
const LATER = new Date(Date.now() + 86_400_000).toISOString();

function story(id: string, userId: string, url: string, caption?: string): Story {
  return {
    id,
    userId,
    mediaUrl: url,
    mediaType: 'image',
    caption,
    createdAt: NOW,
    expiresAt: LATER,
  };
}

const ANA_1 = story('s1', 'u1', 'https://cdn.test/1.jpg', 'Prima poveste');
const ANA_2 = story('s2', 'u1', 'https://cdn.test/2.jpg', 'A doua poveste');
const MEA = story('s9', 'me', 'https://cdn.test/9.jpg');

const GROUPS: UserStories[] = [
  { userId: 'u1', name: 'Ana', storyCount: 2, stories: [ANA_1, ANA_2] },
  { userId: 'me', name: 'Eu', storyCount: 1, stories: [MEA] },
];

/** Eroare HTTP în forma pe care o recunoaște `axios.isAxiosError`. */
function httpError(status: number, detail?: string): Error {
  return {
    isAxiosError: true,
    response: { status, data: detail === undefined ? {} : { detail } },
  } as unknown as Error;
}

/** Eroare de rețea: cerere plecată, niciun răspuns. */
function networkError(): Error {
  return { isAxiosError: true, response: undefined } as unknown as Error;
}

beforeEach(() => {
  vi.mocked(fetchStories).mockResolvedValue(GROUPS);
  vi.mocked(fetchMyStories).mockResolvedValue([MEA]);

  // jsdom nu implementează `createObjectURL`; previzualizarea din modul de
  // creare o cheamă, iar cleanup-ul trebuie să poată chema `revokeObjectURL`.
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:story-preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
});

function renderScreen() {
  return renderWithProviders(<StoriesScreen />);
}

/** Deschide grupul cerut și așteaptă media primei povești. */
async function openGroup(userId: string) {
  fireEvent.click(await screen.findByTestId(`story-group-${userId}`));
  return screen.findByTestId('story-media');
}

describe('stări oneste', () => {
  it('arată spinner cât timp poveștile sunt pe drum', () => {
    vi.mocked(fetchStories).mockReturnValue(new Promise<UserStories[]>(() => {}));
    renderScreen();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('stories-empty')).not.toBeInTheDocument();
  });

  it('lista goală are un text explicativ, nu un ecran alb', async () => {
    vi.mocked(fetchStories).mockResolvedValue([]);
    renderScreen();

    expect(await screen.findByTestId('stories-empty')).toHaveTextContent(
      'Nu există povești de afișat.',
    );
  });

  it('eroarea de rețea se anunță și se poate reîncerca', async () => {
    vi.mocked(fetchStories).mockRejectedValueOnce(new Error('offline'));
    renderScreen();

    expect(await screen.findByTestId('stories-error')).toHaveTextContent(
      'Nu am putut încărca poveștile.',
    );

    vi.mocked(fetchStories).mockResolvedValue(GROUPS);
    fireEvent.click(screen.getByRole('button', { name: 'Reîncearcă' }));

    expect(await screen.findByTestId('story-group-u1')).toBeInTheDocument();
    expect(screen.queryByTestId('stories-error')).not.toBeInTheDocument();
  });
});

describe('bara și vizualizatorul', () => {
  it('arată fiecare grup cu numele și numărul de povești', async () => {
    renderScreen();

    const group = await screen.findByTestId('story-group-u1');
    expect(group).toHaveAttribute('aria-label', 'Vezi poveștile: Ana');
    expect(group).toHaveTextContent('Ana');
    expect(group).toHaveTextContent('2');
    expect(screen.getByTestId('stories-add')).toHaveAttribute('aria-label', 'Adaugă story');
  });

  it('deschide grupul și navighează între povești', async () => {
    renderScreen();

    const media = await openGroup('u1');
    expect(media).toHaveAttribute('src', ANA_1.mediaUrl);
    expect(screen.getByText('Prima poveste')).toBeInTheDocument();
    // Prima poveste: nu există „anterioara".
    expect(screen.getByTestId('story-prev')).toBeDisabled();

    fireEvent.click(screen.getByTestId('story-next'));
    expect(screen.getByTestId('story-media')).toHaveAttribute('src', ANA_2.mediaUrl);
    expect(screen.getByText('A doua poveste')).toBeInTheDocument();
    // Ultima poveste: nu există „următoarea".
    expect(screen.getByTestId('story-next')).toBeDisabled();

    fireEvent.click(screen.getByTestId('story-prev'));
    expect(screen.getByTestId('story-media')).toHaveAttribute('src', ANA_1.mediaUrl);
  });

  it('navighează și cu săgețile de la tastatură', async () => {
    renderScreen();

    await openGroup('u1');
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(screen.getByTestId('story-media')).toHaveAttribute('src', ANA_2.mediaUrl);

    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(screen.getByTestId('story-media')).toHaveAttribute('src', ANA_1.mediaUrl);
  });

  it('la povestea altcuiva arată răspunsul, nu ștergerea', async () => {
    renderScreen();

    await openGroup('u1');
    expect(screen.getByTestId('story-reply-input')).toBeInTheDocument();
    expect(screen.queryByTestId('story-delete')).not.toBeInTheDocument();
  });

  it('la povestea proprie arată ștergerea, nu răspunsul', async () => {
    renderScreen();

    await openGroup('me');
    expect(await screen.findByTestId('story-delete')).toBeInTheDocument();
    expect(screen.queryByTestId('story-reply-input')).not.toBeInTheDocument();
  });
});

describe('răspunsul la o poveste', () => {
  it('trimite textul scris și confirmă discret', async () => {
    vi.mocked(replyToStory).mockResolvedValue({
      chatId: 'c1',
      messageId: 'm1',
      body: 'Salut',
    });
    renderScreen();

    await openGroup('u1');
    fireEvent.change(screen.getByTestId('story-reply-input'), {
      target: { value: 'Salut' },
    });
    fireEvent.click(screen.getByTestId('story-reply-send'));

    await waitFor(() => expect(replyToStory).toHaveBeenCalledWith('s1', 'Salut'));
    expect(await screen.findByText('Trimis ✓')).toBeInTheDocument();
    expect(screen.getByTestId('story-reply-input')).toHaveValue('');
  });

  it('o reacție-emoji pleacă dintr-un singur clic', async () => {
    vi.mocked(replyToStory).mockResolvedValue({ chatId: 'c1', messageId: 'm1', body: '❤️' });
    renderScreen();

    await openGroup('u1');
    fireEvent.click(screen.getByRole('button', { name: 'Reacționează cu ❤️' }));

    await waitFor(() => expect(replyToStory).toHaveBeenCalledWith('s1', '❤️'));
  });

  it('eșecul se vede ÎN PAGINĂ, iar vizualizatorul rămâne deschis', async () => {
    vi.mocked(replyToStory).mockRejectedValue(networkError());
    renderScreen();

    await openGroup('u1');
    fireEvent.change(screen.getByTestId('story-reply-input'), {
      target: { value: 'Salut' },
    });
    fireEvent.click(screen.getByTestId('story-reply-send'));

    expect(
      await screen.findByText('Nu am putut trimite răspunsul. Reîncearcă.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('story-media')).toBeInTheDocument();
    expect(screen.getByTestId('story-reply-input')).toBeInTheDocument();
  });
});

describe('ștergerea propriei povești', () => {
  it('cere confirmare și abia apoi șterge', async () => {
    vi.mocked(deleteStory).mockResolvedValue(undefined);
    renderScreen();

    await openGroup('me');
    fireEvent.click(await screen.findByTestId('story-delete'));

    // Confirmarea e a NOASTRĂ, în DOM — `confirm()` e interzis.
    expect(await screen.findByTestId('story-delete-confirm')).toBeInTheDocument();
    expect(deleteStory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('story-delete-confirm-accept'));

    await waitFor(() => expect(deleteStory).toHaveBeenCalledWith('s9'));
    await waitFor(() =>
      expect(screen.queryByTestId('story-delete-confirm')).not.toBeInTheDocument(),
    );
  });

  it('anularea nu șterge nimic', async () => {
    renderScreen();

    await openGroup('me');
    fireEvent.click(await screen.findByTestId('story-delete'));
    fireEvent.click(await screen.findByTestId('story-delete-confirm-cancel'));

    expect(deleteStory).not.toHaveBeenCalled();
    expect(screen.queryByTestId('story-delete-confirm')).not.toBeInTheDocument();
  });

  it('eșecul ștergerii se vede în pagină, fără să închidă vizualizatorul', async () => {
    vi.mocked(deleteStory).mockRejectedValue(httpError(500));
    renderScreen();

    await openGroup('me');
    fireEvent.click(await screen.findByTestId('story-delete'));
    fireEvent.click(await screen.findByTestId('story-delete-confirm-accept'));

    expect(
      await screen.findByText('Nu am putut șterge povestea. Reîncearcă.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('story-media')).toBeInTheDocument();
  });
});

describe('crearea unei povești', () => {
  const PREPARED_BLOB = { size: 900_000, type: 'image/jpeg' } as Blob;

  function pickedFile(): File {
    return new File(['xxx'], 'poza.jpg', { type: 'image/jpeg' });
  }

  beforeEach(() => {
    vi.mocked(prepareStoryImageInBrowser).mockResolvedValue({
      ok: true,
      blob: PREPARED_BLOB,
      fileName: 'story-1.jpg',
      width: 1920,
      height: 1440,
    });
    vi.mocked(uploadStoryMedia).mockResolvedValue({
      mediaUrl: 'https://cdn.test/new.jpg',
      mediaType: 'image',
    });
    vi.mocked(createStory).mockResolvedValue(story('s10', 'me', 'https://cdn.test/new.jpg'));
  });

  /** Intră în modul de creare și alege un fișier. */
  async function pick(file: File) {
    fireEvent.click(await screen.findByTestId('stories-add'));
    const input = await screen.findByTestId('story-file-input');
    fireEvent.change(input, { target: { files: [file] } });
    return input;
  }

  it('micșorează poza, o încarcă și publică povestea', async () => {
    renderScreen();
    const file = pickedFile();
    await pick(file);

    fireEvent.change(screen.getByPlaceholderText('Adaugă un text…'), {
      target: { value: 'Salutare' },
    });
    fireEvent.click(screen.getByTestId('story-publish'));

    await waitFor(() => expect(prepareStoryImageInBrowser).toHaveBeenCalledWith(file));
    expect(uploadStoryMedia).toHaveBeenCalledWith(
      PREPARED_BLOB,
      'story-1.jpg',
      expect.any(Function),
    );
    await waitFor(() =>
      expect(createStory).toHaveBeenCalledWith(
        'https://cdn.test/new.jpg',
        'image',
        'Salutare',
      ),
    );

    // După publicare ne întoarcem la bară, iar lista se reîncarcă.
    expect(await screen.findByTestId('stories-add')).toBeInTheDocument();
    await waitFor(() => expect(fetchStories).toHaveBeenCalledTimes(2));
    expect(fetchMyStories).toHaveBeenCalledTimes(2);
  });

  it('fără fișier ales, publicarea e blocată', async () => {
    renderScreen();
    fireEvent.click(await screen.findByTestId('stories-add'));

    expect(await screen.findByTestId('story-publish')).toBeDisabled();
  });

  it('poza respinsă de moderare arată mesajul SERVERULUI', async () => {
    vi.mocked(uploadStoryMedia).mockRejectedValue(
      httpError(422, 'Poza conține nuditate și nu poate fi publicată.'),
    );
    renderScreen();
    await pick(pickedFile());

    fireEvent.click(screen.getByTestId('story-publish'));

    const box = await screen.findByTestId('story-upload-error');
    expect(box).toHaveTextContent('Poză respinsă');
    expect(box).toHaveTextContent('Poza conține nuditate și nu poate fi publicată.');
    // Rămânem în modul de creare: poza aleasă nu se pierde.
    expect(screen.getByTestId('story-publish')).toBeInTheDocument();
    expect(createStory).not.toHaveBeenCalled();
  });

  it('poza prea mare după micșorare nici nu se încarcă', async () => {
    vi.mocked(prepareStoryImageInBrowser).mockResolvedValue({
      ok: false,
      reason: 'tooLarge',
      message: 'Poza rămâne prea mare (12 MB) chiar și după micșorare.',
    });
    renderScreen();
    await pick(pickedFile());

    fireEvent.click(screen.getByTestId('story-publish'));

    expect(await screen.findByTestId('story-upload-error')).toHaveTextContent(
      'Poza rămâne prea mare (12 MB) chiar și după micșorare.',
    );
    expect(uploadStoryMedia).not.toHaveBeenCalled();
  });

  it('413 de la server arată limita reală, nu un mesaj generic', async () => {
    vi.mocked(uploadStoryMedia).mockRejectedValue(
      httpError(413, 'Fișier prea mare (max 8388608 bytes).'),
    );
    renderScreen();
    await pick(pickedFile());

    fireEvent.click(screen.getByTestId('story-publish'));

    expect(await screen.findByTestId('story-upload-error')).toHaveTextContent(
      'Fișier prea mare (max 8388608 bytes).',
    );
  });

  it('rețeaua căzută la upload și la creare dau mesaje distincte', async () => {
    vi.mocked(uploadStoryMedia).mockRejectedValueOnce(networkError());
    renderScreen();
    await pick(pickedFile());

    fireEvent.click(screen.getByTestId('story-publish'));
    expect(await screen.findByTestId('story-upload-error')).toHaveTextContent(
      'Nu am putut încărca poza. Încearcă din nou.',
    );

    // A doua oară uploadul reușește, dar cade crearea poveștii.
    vi.mocked(createStory).mockRejectedValueOnce(networkError());
    fireEvent.click(screen.getByTestId('story-publish'));
    expect(await screen.findByText('Nu am putut publica povestea. Încearcă din nou.'))
      .toBeInTheDocument();
  });
});
