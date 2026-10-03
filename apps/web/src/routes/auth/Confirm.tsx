import { useNavigate } from 'react-router-dom';
import { Button, CodeBoxes, Icon, Tile, cn, linkClass, useToast } from '@dialer/ui';
import AuthShell, { AuthForm, AuthTitle } from '@/layouts/AuthShell';

export default function Confirm() {
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <AuthShell signupStep={{ n: 2, label: 'Confirm' }}>
      <AuthForm wide onSubmit={() => navigate('/setup')}>
        <AuthTitle title="Confirm it's you" sub="Two quick checks so leads only ever hear real people." />
        <div className="flex items-center gap-3.5 rounded-2xl bg-success-soft px-[18px] py-4">
          <span className="flex size-[38px] flex-none items-center justify-center rounded-full bg-success text-white"><Icon name="check" /></span>
          <div className="flex-1"><b className="text-15">Email confirmed</b><p className="text-13 text-success-ink">tunde.bakare@gmail.com</p></div>
        </div>
        <div className="flex flex-col gap-4 rounded-2xl border border-line p-4 sm:p-[22px]">
          <div className="flex items-center gap-3.5">
            <Tile tone="brand" size={38}><Icon name="phone" /></Tile>
            <div className="flex-1"><b className="text-15">Enter your phone code</b><p className="text-13 text-muted">Sent by SMS to +234 803 123 4567</p></div>
            <button type="button" className={cn(linkClass, 'text-13')}>Change</button>
          </div>
          <CodeBoxes digits="3071" size="lg" />
          <Button type="submit" variant="primary" size="xl" block>Confirm</Button>
          <div className="flex flex-wrap justify-between gap-2 text-13 text-muted">
            <span>Send again in <b className="text-ink tabular-nums">0:42</b></span>
            <span>No SMS? <button type="button" className={cn(linkClass, 'text-13')} onClick={() => toast('Code sent by WhatsApp to +234 803 123 4567')}>Send by WhatsApp</button></span>
          </div>
        </div>
      </AuthForm>
    </AuthShell>
  );
}
