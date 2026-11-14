import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from ..models.record import Base, Record

engine = create_engine(os.getenv('DATABASE_URL', 'sqlite:///./studypilot.db'))
Session = sessionmaker(bind=engine)
Base.metadata.create_all(engine)
