import sprite from './sprite.svg?raw';

const symbols = sprite.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

export default function Sprite() {
  return (
    <svg width="0" height="0" className="dl-sprite" aria-hidden="true" dangerouslySetInnerHTML={{ __html: symbols }} />
  );
}
