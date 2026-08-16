/**
 * File mention resolution for the TUI composer.
 */

import * as path from 'node:path';

export interface MentionResolution {
  text: string;
  mentions: string[];
}

export function resolveMentions(input: string): MentionResolution {
  const mentions: string[] = [];
  const mentionPattern = /@(\S+)/g;

  const text = input.replace(mentionPattern, (_match, mention: string) => {
    const resolved = path.normalize(mention).replace(/^\.\.\/+/g, '').replace(/^\//, '');
    if (resolved && !mentions.includes(resolved)) {
      mentions.push(resolved);
    }
    return mention;
  });

  return { text, mentions };
}
