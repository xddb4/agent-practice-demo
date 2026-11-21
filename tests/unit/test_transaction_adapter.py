from types import SimpleNamespace

from backend.app.repositories.transactions import begin_write


def session(dialect):
    executed = []
    db = SimpleNamespace(
        bind=SimpleNamespace(dialect=SimpleNamespace(name=dialect)),
        execute=lambda statement: executed.append(str(statement)),
    )
    return db, executed


def test_sqlite_write_lock_is_explicit_and_can_be_skipped_for_reads():
    db, executed = session('sqlite')
    begin_write(db, enabled=False)
    assert executed == []
    begin_write(db)
    assert executed == ['BEGIN IMMEDIATE']


def test_postgresql_never_receives_sqlite_transaction_syntax():
    db, executed = session('postgresql')
    begin_write(db)
    assert executed == []
