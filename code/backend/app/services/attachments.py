"""附件门面：复用所有权校验，按扩展名选择正文提取策略。"""

import base64
import binascii
import uuid
from pathlib import Path

import pymupdf
from fastapi import HTTPException

from ..core.db import Session
from ..repositories.files import FileRepository
from .material_privacy import prepare_material_text
from .ai_safety import SafetyRefusal


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
            return '\f'.join(page.get_text() for page in doc)
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
    prepared = prepare_material_text(material_text)
    name = prepare_material_text(attachment.data['name']).text
    return {'name': name[:180], 'text': prepared.text[:3500]}


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
        # Preserve the extension even if the filename itself is an email address.
        name = prepare_material_text(Path(file.filename or '').stem, source='filename')
        safe_name = name.text + extension
        try:
            content = prepare_material_text(reader(data), source='pdf' if extension == '.pdf' else 'body')
        except SafetyRefusal as error:
            error.detail['file_name'] = safe_name
            raise
        privacy = content.privacy_notice()
        privacy['emails_removed'] += name.emails
        privacy['phones_removed'] += name.phones
        privacy['finding_count'] += len(name.findings)
        privacy['findings'] = (privacy['findings'] + list(name.findings))[:20]
        privacy['limitations'] = [
            '自动检测无法保证发现所有个人信息；请自行检查地址、学号等与分析无关的信息。',
        ]
        if extension in ('.pdf', '.png', '.jpg', '.jpeg', '.webp'):
            privacy['limitations'].append('仅检查可提取文字；图片、扫描件及截图中的信息无法可靠检测，请先遮盖。')
        if not content.text.strip():
            privacy['limitations'].append('未提取到正文，无法据此分析附件内容；请提供可复制文字或粘贴正文。')
        if name.emails or name.phones:
            privacy.update(redacted=True, message='已隐藏附件正文或文件名中的邮箱、手机号，分析仅使用脱敏内容；原文件仍保存在你的附件区。')
        key = str(uuid.uuid4())
        folder = self.root / 'uploads'
        folder.mkdir(exist_ok=True)
        (folder / key).write_bytes(data)
        with Session() as db:
            FileRepository(db, owner).add(key, safe_name, content.text[:30000], privacy)
            db.commit()
        return {'id': key, 'name': safe_name, 'text': content.text[:30000],
                'url': '/api/files/' + key, 'privacy': privacy}

    def download(self, key, owner):
        with Session() as db:
            row = FileRepository(db, owner).get(key)
            return self.root / 'uploads' / key, row.data['name']
