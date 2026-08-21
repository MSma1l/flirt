import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';

import { ThemeProvider } from '@theme/index';

import { ChatListItem } from '../ChatListItem';
import { ChatSummary } from '../types';
import i18n from '@/i18n';

function makeChat(over: Partial<ChatSummary> = {}): ChatSummary {
  return {
    chatId: 'c1',
    otherUserId: 'u2',
    otherName: 'Ana',
    lastMessage: 'Salut, ce faci?',
    lastMessageAt: new Date().toISOString(),
    unreadCount: 0,
    compatibility: 82,
    ...over,
  };
}

function renderItem(chat: ChatSummary) {
  const onPress = jest.fn();
  const utils = render(
    <ThemeProvider>
      <ChatListItem chat={chat} onPress={onPress} />
    </ThemeProvider>,
  );
  return { ...utils, onPress };
}

describe('ChatListItem', () => {
  it('afișează numele, preview-ul mesajului și scorul de compatibilitate', () => {
    const { getByText } = renderItem(makeChat());
    expect(getByText('Ana')).toBeTruthy();
    expect(getByText('Salut, ce faci?')).toBeTruthy();
    expect(getByText('82%')).toBeTruthy();
  });

  it('fără ultim mesaj afișează un placeholder', () => {
    const { getByText } = renderItem(makeChat({ lastMessage: undefined }));
    expect(getByText('Niciun mesaj încă')).toBeTruthy();
  });

  it('afișează badge-ul de necitite când unreadCount > 0', () => {
    const { getByText, getByLabelText } = renderItem(makeChat({ unreadCount: 3 }));
    expect(getByText('3')).toBeTruthy();
    expect(getByLabelText('3 mesaje necitite')).toBeTruthy();
  });

  it('nu afișează badge-ul când nu sunt mesaje necitite', () => {
    const { queryByLabelText } = renderItem(makeChat({ unreadCount: 0 }));
    expect(queryByLabelText('0 mesaje necitite')).toBeNull();
  });

  it('apelează onPress la apăsare', () => {
    const { getByText, onPress } = renderItem(makeChat());
    fireEvent.press(getByText('Ana'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('formatează timpul relativ al ultimului mesaj', () => {
    const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

    expect(renderItem(makeChat({ lastMessageAt: iso(10 * 1000) })).getByText('acum')).toBeTruthy();
    expect(
      renderItem(makeChat({ lastMessageAt: iso(5 * 60 * 1000) })).getByText('5 min'),
    ).toBeTruthy();
    expect(
      renderItem(makeChat({ lastMessageAt: iso(3 * 3600 * 1000) })).getByText('3 h'),
    ).toBeTruthy();
    expect(
      renderItem(makeChat({ lastMessageAt: iso(2 * 86400 * 1000) })).getByText('2 z'),
    ).toBeTruthy();
  });

  it('nu se blochează cu o dată lipsă sau invalidă', () => {
    expect(renderItem(makeChat({ lastMessageAt: undefined })).getByText('Ana')).toBeTruthy();
    expect(renderItem(makeChat({ lastMessageAt: 'nu-e-dată' })).getByText('Ana')).toBeTruthy();
  });

  describe('i18n', () => {
    afterEach(async () => {
      await i18n.changeLanguage('ro');
    });

    it('previewul gol și timpul relativ urmează limba activă', async () => {
      await i18n.changeLanguage('ru');
      const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

      expect(
        renderItem(makeChat({ lastMessage: undefined })).getByText('Пока нет сообщений'),
      ).toBeTruthy();
      expect(
        renderItem(makeChat({ lastMessageAt: iso(10 * 1000) })).getByText('сейчас'),
      ).toBeTruthy();
      expect(
        renderItem(makeChat({ lastMessageAt: iso(3 * 3600 * 1000) })).getByText('3 ч'),
      ).toBeTruthy();
    });

    /**
     * Numărul de necitite NU se scrie cu `${n} mesaje` în cod: româna are trei
     * forme (1 mesaj / 3 mesaje / 21 de mesaje), iar rusa patru. Alegerea o face
     * i18next după regulile CLDR, deci o verificăm pe cifre care cad în categorii
     * diferite.
     */
    it('badge-ul de necitite folosește forma de plural corectă', async () => {
      expect(
        renderItem(makeChat({ unreadCount: 1 })).getByLabelText('1 mesaj necitit'),
      ).toBeTruthy();
      expect(
        renderItem(makeChat({ unreadCount: 21 })).getByLabelText('21 de mesaje necitite'),
      ).toBeTruthy();

      await i18n.changeLanguage('ru');
      expect(
        renderItem(makeChat({ unreadCount: 1 })).getByLabelText('1 непрочитанное сообщение'),
      ).toBeTruthy();
      expect(
        renderItem(makeChat({ unreadCount: 3 })).getByLabelText('3 непрочитанных сообщения'),
      ).toBeTruthy();
      expect(
        renderItem(makeChat({ unreadCount: 7 })).getByLabelText('7 непрочитанных сообщений'),
      ).toBeTruthy();
    });

    it('data de peste o săptămână se scrie în limba activă, nu fix în română', async () => {
      const old = new Date(Date.now() - 30 * 86400 * 1000).toISOString();
      const roText = renderItem(makeChat({ lastMessageAt: old })).getByText(
        new Date(old).toLocaleDateString('ro', { day: 'numeric', month: 'short' }),
      );
      expect(roText).toBeTruthy();

      await i18n.changeLanguage('en');
      expect(
        renderItem(makeChat({ lastMessageAt: old })).getByText(
          new Date(old).toLocaleDateString('en', { day: 'numeric', month: 'short' }),
        ),
      ).toBeTruthy();
    });
  });
});
