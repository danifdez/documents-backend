import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ProjectModule } from './project/project.module';
import { ThreadModule } from './thread/thread.module';
import { DocModule } from './doc/doc.module';
import { ResourceModule } from './resource/resource.module';
import { ResourceTypeModule } from './resource-type/resource-type.module';
import { FileStorageModule } from './file-storage/file-storage.module';
import { JobModule } from './job/job.module';
import { ScheduleModule } from '@nestjs/schedule';
import { TaskScheduleModule } from './task-schedule/task-schedule.module';
import { JobProcessorModule } from './job-processor/job-processor.module';
import { NotificationModule } from './notification/notification.module';
import { ConfigModule } from '@nestjs/config';
import { CommentModule } from './comment/comment.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    ProjectModule,
    ThreadModule,
    DocModule,
    ResourceModule,
    ResourceTypeModule,
    FileStorageModule,
    JobModule,
    JobProcessorModule,
    TaskScheduleModule,
    NotificationModule,
    CommentModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
