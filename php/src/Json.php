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
}
