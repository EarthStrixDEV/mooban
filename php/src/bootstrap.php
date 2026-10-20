<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');

spl_autoload_register(static function (string $class): void {
    foreach ([__DIR__ . "/$class.php", __DIR__ . "/Routes/$class.php"] as $file) {
        if (is_file($file)) {
            require $file;
            return;
        }
    }
});
