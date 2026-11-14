def completed_task_ids(tasks):
    return {str(task['id']) for task in tasks if task.get('done') is True and task.get('id') is not None}


def merge_completion_ids(recorded, previous_tasks, current_tasks):
    """Count distinct tasks that have been successfully saved as completed."""
    return sorted(set(recorded) | completed_task_ids(previous_tasks) | completed_task_ids(current_tasks))
