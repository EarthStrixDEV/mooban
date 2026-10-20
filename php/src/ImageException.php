<?php
declare(strict_types=1);

/** Upload rejected by the image pipeline: carries the HTTP status and error code to answer with. */
final class ImageException extends RuntimeException
{
    public function __construct(public readonly int $status, public readonly string $errorCode)
    {
        parent::__construct($errorCode);
    }
}
