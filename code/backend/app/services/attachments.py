"""附件门面：复用所有权校验，按扩展名选择正文提取策略。"""

import base64
import binascii
import uuid
from pathlib import Path

import pymupdf
from fastapi import HTTPException

from ..core.db import Session
from ..repositories.files import FileRepository
from .ai_safety import guard_text


MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
IMAGE_HEADERS = ('data:image/png;base64', 'data:image/jpeg;base64', 'data:image/webp;base64')


def validate_inline_image(image):
    header, _, encoded = image.partition(',')
    if header not in IMAGE_HEADERS or not encoded or len(encoded) > 13_981_016:
        raise HTTPException(422, '图片必须为不超过 10 MB 的 PNG、JPEG 或 WebP')
    try:
        if len(base64.b64decode(encoded, validate=True)) > MAX_ATTACHMENT_BYTES:
            raise ValueError('image too large')
    except (ValueError, binascii.Error):
        raise HTTPException(422, '图片数据无效或超过 10 MB') from None


def text_reader(data):
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(422, '文本附件需采用UTF-8编码') from None


def pdf_reader(data):
    try:
        with pymupdf.open(stream=data, filetype='pdf') as doc:
            return '\n'.join(page.get_text() for page in doc)
    except Exception:
        raise HTTPException(422, 'PDF无法解析，请粘贴正文或上传有效PDF') from None


def image_reader(_data):
    return ''


TEXT_READERS = {
    '.txt': text_reader, '.md': text_reader, '.pdf': pdf_reader,
    **dict.fromkeys(('.png', '.jpg', '.jpeg', '.webp'), image_reader),
}


def read_material(repository, file_id):
    attachment = repository.get(file_id, detail='辅助资料不存在')
    material_text = attachment.data.get('text', '').strip()
    if not material_text:
        raise HTTPException(422, '辅助资料没有可读取的正文，请粘贴关键信息到情况备注')
    guard_text(material_text, strict=False)
    return {'name': attachment.data['name'][:180], 'text': material_text[:3500]}


class AttachmentService:
    def __init__(self, root):
        self.root = root

    def read_plan_materials(self, owner, material_ids, images):
        if len(material_ids) + len(images) > 3:
            raise HTTPException(422, '每条消息最多添加 3 个附件')
        for image in images:
            validate_inline_image(image)
        if not material_ids:
            return []
        with Session() as db:
            repository = FileRepository(db, owner)
            return [read_material(repository, file_id) for file_id in dict.fromkeys(material_ids)]

    async def upload(self, file, owner):
        extension = Path(file.filename or '').suffix.lower()
        reader = TEXT_READERS.get(extension)
        if reader is None:
            raise HTTPException(422, '支持PDF、文本与图片附件')
        data = await file.read(MAX_ATTACHMENT_BYTES + 1)
        if len(data) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(413, '附件不得超过10MB')
        content = reader(data)
        guard_text(file.filename or '', strict=False)
        guard_text(content, strict=False)
        key = str(uuid.uuid4())
        folder = self.root / 'uploads'
        folder.mkdir(exist_ok=True)
        (folder / key).write_bytes(data)
        with Session() as db:
            FileRepository(db, owner).add(key, file.filename, content[:30000])
            db.commit()
        return {'id': key, 'name': file.filename, 'text': content[:30000], 'url': '/api/files/' + key}

    def download(self, key, owner):
        with Session() as db:
            row = FileRepository(db, owner).get(key)
            return self.root / 'uploads' / key, row.data['name']
