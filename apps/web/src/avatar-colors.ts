export const AVATAR_COLORS = [
  {name:'暖金',value:'#E8B45A'}, {name:'青蓝',value:'#55C4D5'},
  {name:'紫色',value:'#B49BEF'}, {name:'珊瑚',value:'#F28E85'},
  {name:'绿色',value:'#82CBA3'}, {name:'蓝色',value:'#82AEED'},
] as const;
export const DEFAULT_AVATAR_COLOR = AVATAR_COLORS[0].value;
export const isAvatarColor = (value: string): boolean => /^#[0-9a-fA-F]{6}$/.test(value);
export function roleAvatarColor(id?: string | null): string {
  let hash = 0;
  for (const char of id??'') hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length].value;
}
export function avatarBackground(value?: string | null, fallback: string = DEFAULT_AVATAR_COLOR): string {
  return value && isAvatarColor(value) ? value.toUpperCase() : fallback;
}
export function avatarForeground(background: string): string {
  const color = avatarBackground(background);
  const rgb = [1,3,5].map(offset => {
    const channel = parseInt(color.slice(offset,offset + 2),16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000000' : '#FFFFFF';
}
export function avatarStyle(value?: string | null, fallback?: string) {
  const background = avatarBackground(value,fallback);
  return {backgroundColor:background,color:avatarForeground(background)};
}
