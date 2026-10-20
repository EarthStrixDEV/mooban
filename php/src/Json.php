<?php
declare(strict_types=1);

final class Json
{
    /** MySQL 'YYYY-MM-DD HH:MM:SS' (stored UTC) -> 'YYYY-MM-DDTHH:MM:SSZ'. */
    public static function iso(string $mysqlDatetime): string
    {
        return substr($mysqlDatetime, 0, 10) . 'T' . substr($mysqlDatetime, 11, 8) . 'Z';
    }

    /**
     * @param array<string,mixed> $row users row
     * @return array{id:int,handle:string,display_name:string,created_at:string}
     */
    public static function user(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'handle' => (string) $row['handle'],
            'display_name' => (string) $row['display_name'],
            'created_at' => self::iso((string) $row['created_at']),
        ];
    }

    /**
     * @param array<string,mixed> $row posts query row (see Posts::SELECT)
     * @return array<string,mixed>
     */
    public static function post(array $row): array
    {
        $image = null;
        if ($row['img_id'] !== null) {
            $ext = ((string) $row['img_format']) === 'webp' ? 'webp' : 'jpg';
            $base = '/media/' . $row['img_key'] . '/';
            $image = [
                'id' => (int) $row['img_id'],
                'thumb_url' => $base . 'thumb.' . $ext,
                'display_url' => $base . 'display.' . $ext,
                'width' => (int) $row['img_width'],
                'height' => (int) $row['img_height'],
                'alt' => $row['img_alt'] === null ? null : (string) $row['img_alt'],
            ];
        }
        return [
            'id' => (int) $row['id'],
            'body' => (string) $row['body'],
            'author' => [
                'handle' => (string) $row['handle'],
                'display_name' => (string) $row['display_name'],
            ],
            'image' => $image,
            'like_count' => (int) $row['like_count'],
            'comment_count' => (int) $row['comment_count'],
            'liked_by_me' => $row['liked'] !== null,
            'created_at' => self::iso((string) $row['created_at']),
            'updated_at' => self::iso((string) $row['updated_at']),
        ];
    }

    /**
     * Post as carried inside SSE events: same shape, no per-viewer liked_by_me.
     *
     * @param array<string,mixed> $post from Json::post
     * @return array<string,mixed>
     */
    public static function postForEvent(array $post): array
    {
        unset($post['liked_by_me']);
        return $post;
    }
}
