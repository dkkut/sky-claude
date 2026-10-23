-- Карточка музыканта по умолчанию принадлежит тому, кто её создал (загрузил трек).
UPDATE music_artist_cards SET owner_id = created_by WHERE owner_id IS NULL AND created_by IS NOT NULL;
