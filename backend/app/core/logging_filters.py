"""Filters used by the container logging configuration."""
import logging


class WarningOnly(logging.Filter):
    def filter(self, record):
        return record.levelno == logging.WARNING
