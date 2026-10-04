import { Fragment, type ReactNode } from 'react';

export const MERGE_TAGS = ['first_name', 'company', 'city', 'her_time'] as const;
export type MergeTag = (typeof MERGE_TAGS)[number];
export type MergeValues = Record<MergeTag, string>;

export interface ScriptPart { title: string; body: string }

export const SCRIPT_NAME = 'Office cleaning v2';

export const SCRIPT_PARTS: ScriptPart[] = [
  { title: 'Opening', body: "Hi {first_name}, this is Tunde from Bright Clean. I know I'm calling out of the blue, so I'll be quick. Do you have 30 seconds?" },
  { title: "Why I'm calling", body: 'We clean offices across New York for teams like {company}. Most of our clients came to us after their old cleaner kept missing days.' },
  { title: 'Question', body: 'How is cleaning going across your sites right now?' },
  { title: 'If they say "send me an email"', body: "Sure. What's the best email? Can I call Thursday to walk you through it?" },
  { title: 'Close', body: 'Can we book 15 minutes on Thursday at 10 am your time?' },
];

const isTag = (s: string): s is MergeTag => (MERGE_TAGS as readonly string[]).includes(s);

/** Fills a part's text: each {first_name} becomes tag('first_name'). Unknown words stay as written. */
export function renderScript(body: string, tag: (t: MergeTag) => ReactNode): ReactNode[] {
  return body.split(/\{(\w+)\}/g).map((chunk, i) => {
    if (i % 2 === 0) return chunk;
    return isTag(chunk) ? <Fragment key={i}>{tag(chunk)}</Fragment> : `{${chunk}}`;
  });
}
