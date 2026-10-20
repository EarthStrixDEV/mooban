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
            $image = self::postImage([
                'id' => $row['img_id'],
                'media_key' => $row['img_key'],
                'format' => $row['img_format'],
                'width' => $row['img_width'],
                'height' => $row['img_height'],
                'alt' => $row['img_alt'],
            ]);
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
     * Image as embedded in a post: {id, thumb_url, display_url, width, height, alt} (no author).
     *
     * @param array<string,mixed> $row images columns: id, media_key, format, width, height, alt
     * @return array<string,mixed>
     */
    public static function postImage(array $row): array
    {
        $key = (string) $row['media_key'];
        $format = (string) $row['format'];
        return [
            'id' => (int) $row['id'],
            'thumb_url' => Media::url($key, $format, 'thumb'),
            'display_url' => Media::url($key, $format, 'display'),
            'width' => (int) $row['width'],
            'height' => (int) $row['height'],
            'alt' => $row['alt'] === null ? null : (string) $row['alt'],
        ];
    }

    /**
     * Image object for /api/images. $row = images columns + handle, display_name (joined users).
     *
     * @param array<string,mixed> $row
     * @return array<string,mixed>
     */
    public static function image(array $row, bool $withAuthor = true): array
    {
        $out = self::postImage($row) + [
            'format' => (string) $row['format'],
            'bytes_thumb' => (int) $row['bytes_thumb'],
            'bytes_display' => (int) $row['bytes_display'],
            'created_at' => self::iso((string) $row['created_at']),
        ];
        if ($withAuthor) {
            $out['author'] = [
                'handle' => (string) $row['handle'],
                'display_name' => (string) $row['display_name'],
            ];
        }
        return $out;
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
