import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { MessageBubble } from '../MessageBubble';
import { ChatMessage } from '../types';
import { ThemeProvider } from '@theme/index';
import { darkTheme, lightTheme } from '@theme/colors';

// `accent` este identic în ambele teme; îl folosim ca reper stabil.
const ACCENT = darkTheme.accent;

const CURRENT = 'me';

function makeMessage(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'm1',
    senderId: 'other',
    body: 'Salut!',
    wasMasked: false,
    isRead: false,
    createdAt: '2026-07-06T10:00:00Z',
    ...over,
  };
}

function renderBubble(message: ChatMessage, onReact?: (r: string | null) => void) {
  return render(
    <ThemeProvider>
      <MessageBubble message={message} currentUserId={CURRENT} onReact={onReact} />
    </ThemeProvider>,
  );
}

/** Găsește culoarea de fundal a bulei (View interior). */
function bubbleBg(bubble: { props: { style: unknown } }): string | undefined {
  const flat = Array.isArray(bubble.props.style)
    ? Object.assign({}, ...bubble.props.style.flat(Infinity))
    : (bubble.props.style as Record<string, unknown>);
  return flat.backgroundColor as string | undefined;
}

describe('MessageBubble', () => {
  it('mesaj propriu: aliniat dreapta + fundal accent', () => {
    const { getByTestId } = renderBubble(makeMessage({ senderId: CURRENT }));
    const wrap = getByTestId('message-bubble');
    expect(wrap.props.accessibilityLabel).toBe('mesaj propriu');

    const inner = wrap.children[0] as unknown as { props: { style: unknown } };
    expect(bubbleBg(inner)).toBe(ACCENT);
  });

  it('mesaj al celuilalt: aliniat stânga + fundal surface (nu accent)', () => {
    const { getByTestId } = renderBubble(makeMessage({ senderId: 'other' }));
    const wrap = getByTestId('message-bubble');
    expect(wrap.props.accessibilityLabel).toBe('mesaj primit');

    const inner = wrap.children[0] as unknown as { props: { style: unknown } };
    const bg = bubbleBg(inner);
    expect(bg).not.toBe(ACCENT);
    // Fundalul este `surface` din tema activă (light sau dark).
    expect([darkTheme.surface, lightTheme.surface]).toContain(bg);
  });

  it('afișează hintul de siguranță când mesajul e mascat', () => {
    const { getByTestId, getByText } = renderBubble(makeMessage({ wasMasked: true }));
    expect(getByTestId('masked-hint')).toBeTruthy();
    expect(getByText('Contact ascuns pentru siguranță')).toBeTruthy();
  });

  it('nu afișează hintul când mesajul nu e mascat', () => {
    const { queryByTestId } = renderBubble(makeMessage({ wasMasked: false }));
    expect(queryByTestId('masked-hint')).toBeNull();
  });

  it('afișează badge-ul de reacție când e setată', () => {
    const { getByTestId, getByText } = renderBubble(makeMessage({ reaction: '❤️' }));
    expect(getByTestId('reaction-badge')).toBeTruthy();
    expect(getByText('❤️')).toBeTruthy();
  });

  it('nu afișează badge-ul de reacție când lipsește', () => {
    const { queryByTestId } = renderBubble(makeMessage({ reaction: null }));
    expect(queryByTestId('reaction-badge')).toBeNull();
  });

  it('long-press deschide picker-ul și selectarea declanșează onReact', () => {
    const onReact = jest.fn();
    const { getByTestId } = renderBubble(makeMessage(), onReact);

    // Picker-ul nu e vizibil inițial.
    expect(() => getByTestId('reaction-picker')).toThrow();

    fireEvent(getByTestId('message-bubble').children[0] as never, 'longPress');
    expect(getByTestId('reaction-picker')).toBeTruthy();

    fireEvent.press(getByTestId('reaction-option-🔥'));
    expect(onReact).toHaveBeenCalledWith('🔥');
  });

  it('re-selectarea aceleiași reacții o scoate (null)', () => {
    const onReact = jest.fn();
    const { getByTestId } = renderBubble(makeMessage({ reaction: '👍' }), onReact);

    fireEvent(getByTestId('message-bubble').children[0] as never, 'longPress');
    fireEvent.press(getByTestId('reaction-option-👍'));
    expect(onReact).toHaveBeenCalledWith(null);
  });
});
