from sqlalchemy import Column, String, JSON
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class Record(Base):
    __tablename__ = 'records'
    id = Column(String, primary_key=True)
    owner = Column(String, index=True, nullable=False)
    kind = Column(String, index=True, nullable=False)
    data = Column(JSON, nullable=False)
