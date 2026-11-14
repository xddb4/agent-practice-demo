recognizeCourseDemo = function () {
  if (!courseImage) return toast('请先选择课表图片');
  if (!courseImage.url.startsWith('data:image/')) return toast('图片无效');
  askAgent(
    'schedule',
    '识别这张课表。按课表填写星期、起止时间、地点和教学周。只有节次或字段不清楚时留空，不要猜测。',
    courseImage.url,
  );
};
