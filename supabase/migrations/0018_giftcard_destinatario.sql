-- Nombre de la persona a quien se le regala la gift card (para encontrarla si se olvidan la tarjeta).
alter table public.giftcards add column if not exists destinatario text;
create index if not exists giftcards_destinatario on public.giftcards (lower(destinatario));
