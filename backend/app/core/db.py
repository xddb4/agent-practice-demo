import os
from sqlalchemy import create_engine, Column, String, JSON
from sqlalchemy.orm import declarative_base, sessionmaker

engine = create_engine(os.getenv('DATABASE_URL', 'sqlite:///./studypilot.db'))
Session = sessionmaker(bind=engine)
Base = declarative_base()

class Record(Base):
    __tablename__ = 'records'
    id = Column(String, primary_key=True)
    owner = Column(String, index=True, nullable=False)
    kind = Column(String, index=True, nullable=False)
    data = Column(JSON, nullable=False)

Base.metadata.create_all(engine)
