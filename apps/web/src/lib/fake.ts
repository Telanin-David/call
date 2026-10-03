import type { PillTone } from '@dialer/ui';
import { usd } from './money';

export const ME = { name: 'Tunde Bakare', first: 'Tunde', initials: 'TB', email: 'tunde.bakare@gmail.com' };

export const BALANCE = usd(24, 51);

export type AvatarTone = 'a' | 'b' | 'c' | 'd' | 'e';
export type Result = 'interested' | 'callback' | 'no_answer' | 'not_interested' | 'missed';

export const RESULT_LABEL: Record<Result, string> = {
  interested: 'Interested',
  callback: 'Call back',
  no_answer: 'No answer',
  not_interested: 'Not interested',
  missed: 'Missed call',
};

export const RESULT_TONE: Record<Result, PillTone> = {
  interested: 'success',
  callback: 'brand',
  no_answer: 'warn',
  not_interested: 'neutral',
  missed: 'danger',
};

export interface Lead {
  id: string;
  name: string;
  initials: string;
  tone: AvatarTone;
  company: string;
  pronoun: 'her' | 'his';
}

const lead = (id: string, name: string, tone: AvatarTone, company: string, pronoun: Lead['pronoun']): Lead => ({
  id, name, tone, company, pronoun,
  initials: name.split(' ').map(p => p[0]).join(''),
});

export const LEADS = {
  lena: lead('lena', 'Lena Park', 'c', 'Sparkle Offices', 'her'),
  mark: lead('mark', 'Mark Reyes', 'b', 'Reyes Home Care', 'his'),
  kwame: lead('kwame', 'Kwame Mensah', 'a', 'Mensah Facility', 'his'),
  sara: lead('sara', 'Sara Kim', 'b', 'Kim Dental Group', 'her'),
  dan: lead('dan', 'Dan White', 'd', 'White Law LLP', 'his'),
  tom: lead('tom', 'Tom Allen', 'e', 'Allen Janitorial', 'his'),
  ada: lead('ada', 'Ada Obi', 'a', 'Obi Cleaning Co', 'her'),
  rosa: lead('rosa', 'Rosa Diaz', 'd', 'Diaz Maids', 'her'),
  jade: lead('jade', 'Jade Moore', 'e', 'Moore Cleaning', 'her'),
  ben: lead('ben', 'Ben Ortiz', 'c', 'Ortiz Pro Clean', 'his'),
} satisfies Record<string, Lead>;

export interface Followup {
  lead: Lead;
  when: string;
  due: string;
  note: string;
  result: Result;
}

export const FOLLOWUPS_TODAY: Followup[] = [
  { lead: LEADS.dan, when: 'Missed call', due: '9:12 am', note: 'Called your number back. No message.', result: 'missed' },
  { lead: LEADS.lena, when: '3:30 pm her time', due: 'in 2 h', note: 'Wanted a call after 3 pm. Unhappy with her Friday cleaner.', result: 'callback' },
  { lead: LEADS.mark, when: '4:00 pm his time', due: 'in 3 h', note: 'Asked for prices by email first. Sent Monday.', result: 'interested' },
  { lead: LEADS.kwame, when: '5:15 pm his time', due: 'in 4 h', note: 'Decision maker back from leave this week.', result: 'callback' },
  { lead: LEADS.sara, when: '6:00 pm her time', due: 'in 6 h', note: 'Two offices. Wants weekend cleaning.', result: 'interested' },
];

export interface CallRecord {
  when: string;
  lead: Lead;
  result: Result;
  length: string;
  cost: number;
}

export const CALLS: CallRecord[] = [
  { when: 'Today 3:02 pm', lead: LEADS.lena, result: 'callback', length: '4:12', cost: usd(0, 8) },
  { when: 'Today 2:58 pm', lead: LEADS.tom, result: 'no_answer', length: '0:31', cost: usd(0, 1) },
  { when: 'Today 2:51 pm', lead: LEADS.ada, result: 'interested', length: '6:40', cost: usd(0, 13) },
  { when: 'Today 2:44 pm', lead: LEADS.rosa, result: 'not_interested', length: '1:05', cost: usd(0, 2) },
  { when: 'Today 2:40 pm', lead: LEADS.jade, result: 'no_answer', length: '0:28', cost: usd(0, 1) },
  { when: 'Yesterday 4:20 pm', lead: LEADS.ben, result: 'interested', length: '3:18', cost: usd(0, 7) },
  { when: 'Yesterday 4:11 pm', lead: LEADS.kwame, result: 'callback', length: '2:02', cost: usd(0, 4) },
  { when: 'Yesterday 3:57 pm', lead: LEADS.sara, result: 'interested', length: '5:26', cost: usd(0, 11) },
];

export interface LeadDetail {
  title: string;
  phone: string;
  email: string;
  location: string;
  companyNote: string;
  website: string;
  localTime: string;
  lastCall?: { date: string; note: string; result: Result };
  attempt: number;
}

export const DETAILS: Record<string, LeadDetail> = {
  lena: {
    title: 'Office Manager', phone: '+1 (646) 555-0110', email: 'lena@sparkleoffices.com', location: 'Brooklyn, New York',
    companyNote: 'Office cleaning, 3 sites', website: 'sparkleoffices.com', localTime: '3:14 pm', attempt: 3,
    lastCall: { date: '24 Sep', note: 'Asked for a call after 3 pm her time. Uses another cleaner now, not happy with Fridays.', result: 'interested' },
  },
  mark: { title: 'Owner', phone: '+1 (312) 555-0144', email: 'mark@reyeshomecare.com', location: 'Chicago, Illinois', companyNote: 'Home care, 2 offices', website: 'reyeshomecare.com', localTime: '2:14 pm', attempt: 1 },
  rosa: { title: 'Operations Lead', phone: '+1 (718) 555-0162', email: 'rosa@diazmaids.com', location: 'Queens, New York', companyNote: 'Cleaning crew, 12 staff', website: 'diazmaids.com', localTime: '3:14 pm', attempt: 1 },
  kwame: { title: 'Facilities Director', phone: '+1 (917) 555-0131', email: 'kwame@mensahfacility.com', location: 'Newark, New Jersey', companyNote: 'Facility services, 4 sites', website: 'mensahfacility.com', localTime: '3:14 pm', attempt: 2 },
  jade: { title: 'Owner', phone: '+1 (415) 555-0175', email: 'jade@moorecleaning.com', location: 'Oakland, California', companyNote: 'Office cleaning, 1 site', website: 'moorecleaning.com', localTime: '12:14 pm', attempt: 1 },
  ben: { title: 'General Manager', phone: '+1 (646) 555-0193', email: 'ben@ortizproclean.com', location: 'Manhattan, New York', companyNote: 'Commercial cleaning, 6 sites', website: 'ortizproclean.com', localTime: '3:14 pm', attempt: 1 },
};

export interface QueueItem { lead: Lead; done?: string }

export const QUEUE: QueueItem[] = [
  { lead: LEADS.tom, done: 'No answer' },
  { lead: LEADS.ada, done: 'Call back tomorrow' },
  { lead: LEADS.lena },
  { lead: LEADS.mark },
  { lead: LEADS.rosa },
  { lead: LEADS.kwame },
  { lead: LEADS.jade },
  { lead: LEADS.ben },
];
