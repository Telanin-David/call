import { useState } from 'react';

export default function PasswordInput({ defaultValue = '', id }: { defaultValue?: string; id?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="dl-pw">
      <input id={id} className="dl-input" type={shown ? 'text' : 'password'} defaultValue={defaultValue} />
      <button type="button" className="dl-link" onClick={() => setShown(s => !s)}>{shown ? 'Hide' : 'Show'}</button>
    </div>
  );
}
