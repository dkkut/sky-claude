-- Фото исполнителя на прозрачном фоне («Мой поток» в Sky Music): третий вид картинки карточки музыканта.
ALTER TABLE music_card_images DROP CONSTRAINT IF EXISTS music_card_images_kind_check;
ALTER TABLE music_card_images ADD CONSTRAINT music_card_images_kind_check CHECK (kind IN ('photo','banner','cutout'));
